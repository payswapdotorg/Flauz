/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz layered browser navigation policy engine (Wave 4, Lane I).
 *
 * Model basis (BROWSER-ARCHITECTURE.md section 5, DL-6, SECURITY-MODEL.md
 * section 4): CDP-initiated navigations BYPASS the Electron `will-navigate`
 * event (B1c), so a single-layer gate is not sound. The policy therefore
 * evaluates every navigation against a LAYERED allowlist model:
 *
 *   L1 driver      -- the driver-side navigate allowlist. AUTHORITATIVE for
 *                     agent-initiated navigation: its deny verdict wins over
 *                     every other layer (it is what navigateBrowserTool.ts
 *                     consults before issuing any CDP Page.navigate).
 *   L2 webRequest  -- session-level content/exfil rules (the airtight content
 *                     gate; also consulted post-commit for reconciliation).
 *   L3 willNavigate-- rules for user-initiated navigations only (CDP navs
 *                     never fire it -- the B1c finding).
 *   L4 partitions  -- per-workspace (+ optional per-agent) session isolation:
 *                     `persist:flauz-<workspace-hash>[-<agent-id>]`.
 *
 * Precedence: DENY AT ANY LAYER WINS. The combined verdict reports the first
 * denying layer in the order partition > driver > webRequest > willNavigate.
 * A driver ALLOW never overrides another layer's deny (that is the whole
 * point of the B1c insurance: each layer must be able to deny alone).
 *
 * Fail-closed properties (pinned by tests):
 *   - missing policy file            -> deny-all builtin default
 *   - broken policy file             -> deny-all builtin default + carried error
 *   - unparseable navigation URL     -> deny at every layer
 *   - every gate layer kill-switched -> deny (no-enabled-gate fail-closed)
 *
 * This module is PURE: no `vscode` import, no Node import. It runs identically
 * under `node --test` and inside the extension host (src/extension.ts owns all
 * host wiring). The domain-matching semantics mirror the in-tree filter
 * (src/vs/platform/networkFilter/common/domainMatcher.ts + networkFilterService.ts:
 * "When both domain lists are empty, all domains are denied... denied list
 * always wins") so extension-land verdicts agree with the tree-side gate.
 */

// #region Constants and core types

/** Schema identifier pinned into `.flauz/browser-policy.json`. */
export const POLICY_SCHEMA_ID = 'flauz.browser-policy/v0';

/** Policy file path, relative to the workspace root (git-diffable, DL-9 family). */
export const POLICY_PATH = '.flauz/browser-policy.json';

/** The only schema version understood by this engine (DL-29 proposal: bump on breaking change). */
export const POLICY_SCHEMA_VERSION = 0;

/** The gate layers, in precedence order (first deny wins). */
export const POLICY_LAYERS = ['driver', 'webRequest', 'willNavigate'] as const;
export type PolicyLayer = (typeof POLICY_LAYERS)[number];

/** Layer reported on a verdict beyond the three gate layers. */
export type VerdictLayer = PolicyLayer | 'partition' | 'policyFile';

/**
 * Who initiated the navigation. Drives which layers are ON THE PATH (B1c):
 *   'agent-tool' -- CDP Page.navigate issued through the browser tool:
 *                   driver (pre-navigation check) + webRequest fire;
 *                   will-navigate does NOT fire.
 *   'user'       -- omnibox / link click: will-navigate + webRequest fire;
 *                   the driver allowlist is not on the user path.
 */
export const NAVIGATION_INITIATORS = ['agent-tool', 'user'] as const;
export type NavigationInitiator = (typeof NAVIGATION_INITIATORS)[number];

export type PolicyDecision = 'allow' | 'deny';

/** Injectable clock (deterministic tests; Date.now in the host). */
export type Clock = () => number;

// #endregion

// #region Policy shape

/** Per-layer rule block (allow/deny host patterns + kill-switch + driver-only file roots). */
export interface LayerRules {
	/** Gate kill-switch: when false the layer never denies (test/insurance posture). Default true. */
	readonly enabled: boolean;
	/** Allowed host patterns (upstream matcher semantics: `*.example.com`, `example.com`, `*`). */
	readonly allow: readonly string[];
	/** Denied host patterns. Denied always wins over allowed. */
	readonly deny: readonly string[];
	/** Driver-only: trusted file:// roots (absolute POSIX or workspace-relative). file:// outside these roots is denied at the driver layer. */
	readonly fileRoots: readonly string[];
}

/** Partition derivation rules (L4 isolation posture). */
export interface PartitionRules {
	/** 'persist' -> `persist:flauz-<hash>[-<agent>]` (durable jar); 'memory' -> in-memory `flauz-<hash>[-<agent>]`. */
	readonly scope: 'persist' | 'memory';
	/** When true (and an agentId is supplied) the partition gains the `-<agent-id>` suffix. */
	readonly perAgent: boolean;
}

/** Fully resolved, validated policy. */
export interface BrowserPolicy {
	readonly schemaVersion: number;
	readonly driver: LayerRules;
	readonly webRequest: LayerRules;
	readonly willNavigate: LayerRules;
	readonly partitions: PartitionRules;
}

/** Where the effective policy came from. */
export type PolicySource = 'workspace-file' | 'builtin-default';

// #endregion

// #region Error classes

export type PolicyErrorCode =
	| 'FLAUZ_POLICY_PARSE'       // file is not valid JSON
	| 'FLAUZ_POLICY_VERSION'     // unsupported schemaVersion
	| 'FLAUZ_POLICY_SCHEMA'      // structural/schema violation (carries a JSON path)
	| 'FLAUZ_POLICY_PARTITION';  // partition name or derivation input invalid

/** Typed policy error: stable `code` + the JSON path of the offending member ('' = whole document). */
export class PolicyError extends Error {
	readonly code: PolicyErrorCode;
	readonly path: string;

	constructor(code: PolicyErrorCode, path: string, message: string) {
		super(`flauz.browser-policy: [${code}]${path === '' ? '' : ` ${path}`}: ${message}`);
		this.name = 'PolicyError';
		this.code = code;
		this.path = path;
	}
}

// #endregion

// #region Host pattern matching (mirrors the in-tree network filter semantics)

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const IPV6_BRACKETS = /^\[[0-9a-f:]+\]$/;

/**
 * Normalizes a host allow/deny pattern to the canonical form used for matching.
 *
 * Accepts bare hosts (`example.com`), wildcard prefixes (`*.example.com`), a
 * bare wildcard (`*`), full URLs (`https://example.com/x` -- authority wins),
 * `user@host` and `host:port` forms. IPv6 literals must be bracketed
 * (`[::1]`). Returns `undefined` for anything that cannot be a host pattern
 * (spaces, slashes, empty labels, trailing `..`) -- policy load turns that
 * into a FLAUZ_POLICY_SCHEMA error.
 */
export function normalizeHostPattern(pattern: string): string | undefined {
	let candidate = pattern.trim();
	if (candidate === '') {
		return undefined;
	}
	if (candidate.includes('://')) {
		const parsed = URL.parse(candidate);
		if (parsed === null) {
			return undefined;
		}
		candidate = parsed.hostname;
	} else {
		const at = candidate.lastIndexOf('@');
		if (at >= 0) {
			candidate = candidate.slice(at + 1);
		}
		if (!candidate.startsWith('[')) {
			candidate = candidate.replace(/:\d+$/, '');
		}
	}
	candidate = candidate.toLowerCase().replace(/\.+$/, '');
	if (candidate === '' || candidate === '.') {
		return undefined;
	}
	if (candidate.includes('/') || candidate.includes(' ') || candidate.includes('\\')) {
		return undefined;
	}
	if (candidate === '*') {
		return '*';
	}
	if (candidate.startsWith('*.')) {
		const host = candidate.slice(2);
		return isPlainHost(host) ? `*.${host}` : undefined;
	}
	return isPlainHost(candidate) ? candidate : undefined;
}

function isPlainHost(host: string): boolean {
	if (IPV6_BRACKETS.test(host)) {
		return true;
	}
	if (host.includes('[') || host.includes(']')) {
		return false;
	}
	const labels = host.split('.');
	if (labels.some(label => !HOST_LABEL.test(label))) {
		return false;
	}
	return true;
}

/** True when `host` (already normalized: lowercase, bracketed IPv6) matches `pattern` (normalized). */
export function hostMatches(host: string, pattern: string): boolean {
	if (pattern === '*') {
		return true;
	}
	if (pattern.startsWith('*.')) {
		const suffix = pattern.slice(2);
		return host === suffix || host.endsWith(`.${suffix}`);
	}
	return host === pattern;
}

/**
 * The upstream allow/deny algorithm, mirrored exactly
 * (networkFilterService.ts:26-35 + domainMatcher.ts isDomainAllowed):
 *   - both lists empty            -> DENY (restrictive default)
 *   - any denied pattern matches  -> DENY (denied list always wins)
 *   - allowed empty, denied set   -> allow anything not denied
 *   - allowed set                 -> must match at least one allowed pattern
 */
export function isDomainAllowed(host: string, allowedPatterns: readonly string[], deniedPatterns: readonly string[]): boolean {
	if (allowedPatterns.length === 0 && deniedPatterns.length === 0) {
		return false;
	}
	if (deniedPatterns.some(pattern => hostMatches(host, pattern))) {
		return false;
	}
	if (allowedPatterns.length === 0) {
		return true;
	}
	return allowedPatterns.some(pattern => hostMatches(host, pattern));
}

// #endregion

// #region Navigation target classification

export type TargetKind = 'network' | 'file' | 'aboutBlank' | 'other';

export interface TargetClassification {
	readonly kind: TargetKind;
	readonly url: URL | null;
	readonly host: string;
	/** file:// path (kind 'file' only). */
	readonly filePath: string;
}

const FILTERED_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);

/** The forced-reset target for post-violation reconciliation (SECURITY-MODEL section 4 F2). */
export const RESET_URL = 'about:blank';

/**
 * Classifies a navigation target. Mirrors the in-tree scheme handling
 * (networkFilterService.ts isFilteredNetworkScheme + "file URIs and unfiltered
 * schemes without an authority always pass"): http/https/ws/wss are network,
 * file: is file, about:blank is special, and other no-authority schemes are
 * 'other'. Unparseable input classifies as `url: null` -> every layer denies.
 */
export function classifyTarget(url: string): TargetClassification {
	const parsed = URL.parse(url);
	if (parsed === null) {
		return { kind: 'other', url: null, host: '', filePath: '' };
	}
	if (parsed.protocol === 'about:') {
		return { kind: 'aboutBlank', url: parsed, host: '', filePath: '' };
	}
	if (parsed.protocol === 'file:') {
		return { kind: 'file', url: parsed, host: parsed.hostname, filePath: decodeURIComponent(parsed.pathname) };
	}
	if (FILTERED_SCHEMES.has(parsed.protocol)) {
		return { kind: 'network', url: parsed, host: parsed.hostname, filePath: '' };
	}
	return { kind: 'other', url: parsed, host: parsed.hostname, filePath: '' };
}

// #endregion

// #region Partitions (L4)

/** Prefix of durable Flauz partitions. */
export const PARTITION_PERSIST_PREFIX = 'persist:flauz-';
/** Prefix of in-memory Flauz partitions (no `persist:` -> not persisted by Electron). */
export const PARTITION_MEMORY_PREFIX = 'flauz-';

/** Length of the workspace hash segment (16 lowercase hex chars = 64 bits). */
export const WORKSPACE_HASH_LENGTH = 16;

const PARTITION_PERSIST_RE = /^persist:flauz-([0-9a-f]{16})(-([A-Za-z0-9._-]{1,64}))?$/;
const PARTITION_MEMORY_RE = /^flauz-([0-9a-f]{16})(-([A-Za-z0-9._-]{1,64}))?$/;
const AGENT_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

export interface PartitionNameParts {
	readonly scope: 'persist' | 'memory';
	readonly workspaceHash: string;
	readonly agentId: string | undefined;
}

/** sha256 over the workspace root, truncated to 16 lowercase hex chars. */
export function workspaceHashOf(workspaceRoot: string): string {
	if (typeof workspaceRoot !== 'string' || workspaceRoot === '') {
		throw new PolicyError('FLAUZ_POLICY_PARTITION', '', 'workspaceRoot must be a non-empty string');
	}
	return sha256Hex(workspaceRoot).slice(0, WORKSPACE_HASH_LENGTH);
}

/**
 * Derives the Flauz partition name for a workspace (plus optional agent):
 *   persist scope: `persist:flauz-<workspace-hash>[-<agent-id>]`
 *   memory scope:  `flauz-<workspace-hash>[-<agent-id>]`
 *
 * Passing an agentId while `partitions.perAgent` is false throws
 * (fail-closed on misuse: the caller asked for isolation the policy did not
 * grant -- silently sharing the workspace jar would be the vulnerability).
 */
export function derivePartition(workspaceRoot: string, agentId: string | undefined, rules: PartitionRules): string {
	const hash = workspaceHashOf(workspaceRoot);
	let suffix = '';
	if (agentId !== undefined) {
		if (!rules.perAgent) {
			throw new PolicyError('FLAUZ_POLICY_PARTITION', 'partitions.perAgent', 'per-agent partition requested but partitions.perAgent is false');
		}
		if (!AGENT_ID_RE.test(agentId)) {
			throw new PolicyError('FLAUZ_POLICY_PARTITION', 'agentId', `agentId must match ${AGENT_ID_RE.source} (got ${JSON.stringify(agentId)})`);
		}
		suffix = `-${agentId}`;
	}
	return (rules.scope === 'persist' ? PARTITION_PERSIST_PREFIX : PARTITION_MEMORY_PREFIX) + hash + suffix;
}

/** Validates the partition name shape; returns parts or a typed error. */
export function validatePartitionName(name: string): { ok: true; parts: PartitionNameParts } | { ok: false; error: PolicyError } {
	if (typeof name !== 'string' || name === '') {
		return { ok: false, error: new PolicyError('FLAUZ_POLICY_PARTITION', '', 'partition name must be a non-empty string') };
	}
	const persist = PARTITION_PERSIST_RE.exec(name);
	if (persist !== null) {
		return { ok: true, parts: { scope: 'persist', workspaceHash: persist[1] ?? '', agentId: persist[3] } };
	}
	const memory = PARTITION_MEMORY_RE.exec(name);
	if (memory !== null) {
		return { ok: true, parts: { scope: 'memory', workspaceHash: memory[1] ?? '', agentId: memory[3] } };
	}
	return { ok: false, error: new PolicyError('FLAUZ_POLICY_PARTITION', '', `partition name must match persist:flauz-<16hex>[-<agent-id>] or flauz-<16hex>[-<agent-id>] (got ${JSON.stringify(name)})`) };
}

// #endregion

// #region Verdicts

/** The audit verdict object: allow/deny + layer + reason (+ matched rule). */
export interface PolicyVerdict {
	readonly decision: PolicyDecision;
	readonly layer: VerdictLayer;
	readonly reason: string;
	/** The pattern or rule that produced the decision, when attributable. */
	readonly rule: string | undefined;
	readonly url: string;
	readonly partition: string;
	readonly initiator: NavigationInitiator;
	readonly policyVersion: number;
	readonly policySource: PolicySource;
	readonly ts: number;
}

export interface EvaluationResult {
	/** Combined verdict: deny-at-any-layer wins; first denying layer in precedence order. */
	readonly final: PolicyVerdict;
	/** Every consulted layer's verdict, in precedence order (including kill-switched allows). */
	readonly layers: readonly PolicyVerdict[];
}

export interface NavigationCheck {
	readonly url: string;
	readonly initiator: NavigationInitiator;
	/** Partition the navigation targets (containment is checked when provided). */
	readonly partition?: string;
	/** Workspace root (partition containment + relative fileRoots resolution). */
	readonly workspaceRoot?: string;
	readonly ts?: number;
}

/** One-line human-readable verdict for logs and canary assertions. */
export function formatVerdictLine(verdict: PolicyVerdict): string {
	const rule = verdict.rule === undefined ? '' : ` rule=${verdict.rule}`;
	return `${verdict.decision} ${verdict.layer} ${verdict.url} -- ${verdict.reason}${rule} [v${verdict.policyVersion} ${verdict.policySource}]`;
}

// #endregion

// #region Layer evaluation

const DEFAULT_PARTITIONS: PartitionRules = { scope: 'persist', perAgent: false };

/** The builtin deny-all default policy (all layers enabled, empty lists, persist workspace partition). */
export const DEFAULT_POLICY: BrowserPolicy = {
	schemaVersion: POLICY_SCHEMA_VERSION,
	driver: { enabled: true, allow: [], deny: [], fileRoots: [] },
	webRequest: { enabled: true, allow: [], deny: [], fileRoots: [] },
	willNavigate: { enabled: true, allow: [], deny: [], fileRoots: [] },
	partitions: DEFAULT_PARTITIONS,
};

function deniedBy(host: string, allow: readonly string[], deny: readonly string[]): { allowed: boolean; rule: string | undefined } {
	const deniedByPattern = deny.find(pattern => hostMatches(host, pattern));
	if (deniedByPattern !== undefined) {
		return { allowed: false, rule: deniedByPattern };
	}
	const allowedByPattern = allow.find(pattern => hostMatches(host, pattern));
	if (allowedByPattern !== undefined) {
		return { allowed: true, rule: allowedByPattern };
	}
	// Empty lists fall through to the restrictive default (mirrored upstream algorithm).
	if (allow.length === 0 && deny.length === 0) {
		return { allowed: false, rule: undefined };
	}
	if (allow.length === 0) {
		return { allowed: true, rule: undefined };
	}
	return { allowed: false, rule: undefined };
}

function isPathUnderRoot(path: string, root: string): boolean {
	const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
	if (normalizedRoot === '') {
		return false;
	}
	return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
}

function resolveFileRoot(root: string, workspaceRoot: string | undefined): string | undefined {
	if (root.startsWith('/')) {
		return root;
	}
	if (workspaceRoot === undefined) {
		return undefined;
	}
	const base = workspaceRoot.endsWith('/') ? workspaceRoot : `${workspaceRoot}/`;
	return base + root;
}

/**
 * Evaluates one layer's rules against a target. Pure function of
 * (rules, layer, target, context); the engine composes these into the
 * combined verdict.
 */
export function evaluateLayerRules(
	layer: PolicyLayer,
	rules: LayerRules,
	url: string,
	options: { partition: string | undefined; workspaceRoot: string | undefined; initiator: NavigationInitiator; ts: number; policyVersion: number; policySource: PolicySource },
): PolicyVerdict {
	const base = { url, partition: options.partition ?? '', initiator: options.initiator, policyVersion: options.policyVersion, policySource: options.policySource, ts: options.ts };
	if (!rules.enabled) {
		return { ...base, decision: 'allow', layer, reason: `layer kill-switched (enabled=false): other layers must carry every deny (B1c insurance)`, rule: undefined };
	}
	const target = classifyTarget(url);
	if (target.url === null) {
		return { ...base, decision: 'deny', layer, reason: 'unparseable navigation URL (fail-closed)', rule: undefined };
	}
	switch (target.kind) {
		case 'aboutBlank':
			return { ...base, decision: 'allow', layer, reason: 'about:blank is always allowed (reconciliation reset target)', rule: undefined };
		case 'file': {
			// webRequest + willNavigate mirror the tree: file URIs pass those layers.
			if (layer !== 'driver') {
				return { ...base, decision: 'allow', layer, reason: 'file URIs pass this layer (mirrors the in-tree filter; the driver layer owns file-root gating)', rule: undefined };
			}
			if (target.host !== '' && target.host !== 'localhost') {
				return { ...base, decision: 'deny', layer, reason: `file:// with remote host '${target.host}' is not under any trusted root`, rule: undefined };
			}
			for (const root of rules.fileRoots) {
				const resolved = resolveFileRoot(root, options.workspaceRoot);
				if (resolved === undefined) {
					continue;
				}
				if (isPathUnderRoot(target.filePath, resolved)) {
					return { ...base, decision: 'allow', layer, reason: `file path is under trusted root '${root}'`, rule: root };
				}
			}
			const why = rules.fileRoots.length === 0
				? 'no trusted fileRoots configured (deny-all)'
				: options.workspaceRoot === undefined && rules.fileRoots.some(root => !root.startsWith('/'))
					? 'relative fileRoots cannot be resolved without a workspaceRoot context'
					: 'file path is outside every trusted root';
			return { ...base, decision: 'deny', layer, reason: `file:// navigation denied at the driver layer: ${why}`, rule: undefined };
		}
		case 'network': {
			const outcome = deniedBy(target.host, rules.allow, rules.deny);
			if (!outcome.allowed) {
				const reason = outcome.rule !== undefined && rules.deny.includes(outcome.rule)
					? `host '${target.host}' matches deny pattern '${outcome.rule}' (denied list always wins)`
					: rules.allow.length === 0 && rules.deny.length === 0
						? 'no allowlist configured: all domains denied (restrictive default)'
						: `host '${target.host}' is not in the ${layer} allowlist`;
				return { ...base, decision: 'deny', layer, reason, rule: outcome.rule };
			}
			return { ...base, decision: 'allow', layer, reason: `host '${target.host}' allowed by ${layer} rules`, rule: outcome.rule };
		}
		case 'other': {
			// webRequest + willNavigate mirror the tree: unfiltered schemes
			// without an authority pass. The driver layer is Flauz-owned and
			// stricter: only network/file/about-blank may be agent-driven.
			if (layer === 'driver') {
				return { ...base, decision: 'deny', layer, reason: `scheme '${target.url.protocol}' is not agent-drivable at the driver layer (http/https/ws/wss/file/about:blank only)`, rule: undefined };
			}
			return { ...base, decision: 'allow', layer, reason: `scheme '${target.url.protocol}' without authority passes this layer (mirrors the in-tree filter)`, rule: undefined };
		}
	}
}

/** Partition containment verdict (L4): shape, scope, and workspace-hash checks. */
export function checkPartition(
	partition: string | undefined,
	context: { workspaceRoot: string | undefined; expectedScope: 'persist' | 'memory' | undefined; initiator: NavigationInitiator; ts: number; policyVersion: number; policySource: PolicySource },
): PolicyVerdict {
	const base = { url: '', partition: partition ?? '', initiator: context.initiator, policyVersion: context.policyVersion, policySource: context.policySource, ts: context.ts };
	if (partition === undefined) {
		return { ...base, decision: 'allow', layer: 'partition', reason: 'no partition context on this navigation', rule: undefined };
	}
	const validated = validatePartitionName(partition);
	if (!validated.ok) {
		return { ...base, decision: 'deny', layer: 'partition', reason: `malformed partition name: ${validated.error.message}`, rule: undefined };
	}
	const parts = validated.parts;
	if (context.expectedScope !== undefined && parts.scope !== context.expectedScope) {
		return { ...base, decision: 'deny', layer: 'partition', reason: `partition scope mismatch: policy requires '${context.expectedScope}' but the name is '${parts.scope}' scope`, rule: undefined };
	}
	if (context.workspaceRoot !== undefined && parts.workspaceHash !== workspaceHashOf(context.workspaceRoot)) {
		return { ...base, decision: 'deny', layer: 'partition', reason: `cross-workspace partition: name belongs to workspace hash '${parts.workspaceHash}' but the caller workspace hashes to '${workspaceHashOf(context.workspaceRoot)}'`, rule: undefined };
	}
	return { ...base, decision: 'allow', layer: 'partition', reason: `partition name valid (${parts.scope} scope, workspace '${parts.workspaceHash}'${parts.agentId === undefined ? '' : `, agent '${parts.agentId}'`})`, rule: undefined };
}

// #endregion

// #region Policy parsing and validation

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLayerRules(path: string, value: unknown, layer: PolicyLayer): LayerRules {
	if (!isPlainObject(value)) {
		throw new PolicyError('FLAUZ_POLICY_SCHEMA', path, `${layer} rules must be an object { enabled?, allow?, deny?, fileRoots? }`);
	}
	const rules: { enabled: boolean; allow: string[]; deny: string[]; fileRoots: string[] } = { enabled: true, allow: [], deny: [], fileRoots: [] };
	for (const [key, raw] of Object.entries(value)) {
		switch (key) {
			case 'enabled':
				if (typeof raw !== 'boolean') {
					throw new PolicyError('FLAUZ_POLICY_SCHEMA', `${path}.enabled`, `must be a boolean (got ${JSON.stringify(raw)})`);
				}
				rules.enabled = raw;
				break;
			case 'allow':
			case 'deny':
			case 'fileRoots': {
				const listPath = `${path}.${key}`;
				if (!Array.isArray(raw)) {
					throw new PolicyError('FLAUZ_POLICY_SCHEMA', listPath, `must be an array of ${key === 'fileRoots' ? 'root paths' : 'host patterns'}`);
				}
				if (key === 'fileRoots' && layer !== 'driver') {
					throw new PolicyError('FLAUZ_POLICY_SCHEMA', listPath, `fileRoots is a driver-layer rule only (declared on '${layer}')`);
				}
				const list: string[] = [];
				raw.forEach((entry, index) => {
					const entryPath = `${listPath}[${index}]`;
					if (typeof entry !== 'string' || entry.trim() === '') {
						throw new PolicyError('FLAUZ_POLICY_SCHEMA', entryPath, `must be a non-empty string (got ${JSON.stringify(entry)})`);
					}
					if (key === 'fileRoots') {
						const normalizedRoot = entry.endsWith('/') && entry !== '/' ? entry.slice(0, -1) : entry;
						const segments = normalizedRoot.split('/');
						const body = normalizedRoot.startsWith('/') ? segments.slice(1) : segments;
						if (normalizedRoot === '/' || entry.includes('\\') || body.some(segment => segment === '..' || segment === '')) {
							throw new PolicyError('FLAUZ_POLICY_SCHEMA', entryPath, `fileRoot must be an absolute POSIX path or workspace-relative path without '..' or empty segments (got ${JSON.stringify(entry)})`);
						}
						list.push(normalizedRoot);
					} else {
						const normalized = normalizeHostPattern(entry);
						if (normalized === undefined) {
							throw new PolicyError('FLAUZ_POLICY_SCHEMA', entryPath, `not a valid host pattern (expected example.com, *.example.com, *, a URL authority, or a bracketed IPv6 literal; got ${JSON.stringify(entry)})`);
						}
						list.push(normalized);
					}
				});
				if (key === 'allow') {
					rules.allow = list;
				} else if (key === 'deny') {
					rules.deny = list;
				} else {
					rules.fileRoots = list;
				}
				break;
			}
			default:
				throw new PolicyError('FLAUZ_POLICY_SCHEMA', `${path}.${key}`, `unknown ${layer} rule key (allowed: enabled, allow, deny${layer === 'driver' ? ', fileRoots' : ''})`);
		}
	}
	return rules;
}

function parsePartitionRules(value: unknown): PartitionRules {
	if (!isPlainObject(value)) {
		throw new PolicyError('FLAUZ_POLICY_SCHEMA', 'partitions', `must be an object { scope?, perAgent? }`);
	}
	const rules: { scope: 'persist' | 'memory'; perAgent: boolean } = { scope: 'persist', perAgent: false };
	for (const [key, raw] of Object.entries(value)) {
		switch (key) {
			case 'scope':
				if (raw !== 'persist' && raw !== 'memory') {
					throw new PolicyError('FLAUZ_POLICY_SCHEMA', 'partitions.scope', `must be 'persist' or 'memory' (got ${JSON.stringify(raw)})`);
				}
				rules.scope = raw;
				break;
			case 'perAgent':
				if (typeof raw !== 'boolean') {
					throw new PolicyError('FLAUZ_POLICY_SCHEMA', 'partitions.perAgent', `must be a boolean (got ${JSON.stringify(raw)})`);
				}
				rules.perAgent = raw;
				break;
			default:
				throw new PolicyError('FLAUZ_POLICY_SCHEMA', `partitions.${key}`, 'unknown partitions key (allowed: scope, perAgent)');
		}
	}
	return rules;
}

export interface PolicyParseResult {
	readonly policy: BrowserPolicy;
	/** Non-fatal advisories (kill-switches active, etc.) -- surfaced in logs and verdict context. */
	readonly warnings: readonly string[];
}

/**
 * Parses and validates a policy document. Throws PolicyError
 * (FLAUZ_POLICY_PARSE / FLAUZ_POLICY_VERSION / FLAUZ_POLICY_SCHEMA) on any
 * violation; host patterns are NORMALIZED at load so evaluation never sees an
 * unvalidated pattern.
 */
export function parsePolicyText(text: string): PolicyParseResult {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		throw new PolicyError('FLAUZ_POLICY_PARSE', '', `policy file is not valid JSON: ${(err as Error).message}`);
	}
	if (!isPlainObject(raw)) {
		throw new PolicyError('FLAUZ_POLICY_SCHEMA', '', 'policy document must be a JSON object');
	}
	if (!('schemaVersion' in raw)) {
		throw new PolicyError('FLAUZ_POLICY_SCHEMA', 'schemaVersion', 'required key missing (expected 0)');
	}
	const version = raw['schemaVersion'];
	if (typeof version !== 'number' || !Number.isInteger(version)) {
		throw new PolicyError('FLAUZ_POLICY_SCHEMA', 'schemaVersion', `must be an integer (got ${JSON.stringify(version)})`);
	}
	if (version !== POLICY_SCHEMA_VERSION) {
		throw new PolicyError('FLAUZ_POLICY_VERSION', 'schemaVersion', `unsupported schemaVersion ${JSON.stringify(version)} (this engine understands ${POLICY_SCHEMA_VERSION} only; DL-29 versioning)`);
	}

	const policy: { schemaVersion: number; driver: LayerRules; webRequest: LayerRules; willNavigate: LayerRules; partitions: PartitionRules } = {
		schemaVersion: version,
		driver: DEFAULT_POLICY.driver,
		webRequest: DEFAULT_POLICY.webRequest,
		willNavigate: DEFAULT_POLICY.willNavigate,
		partitions: DEFAULT_POLICY.partitions,
	};
	for (const [key, value] of Object.entries(raw)) {
		switch (key) {
			case 'schemaVersion':
				break;
			case 'driver':
				policy.driver = parseLayerRules('driver', value, 'driver');
				break;
			case 'webRequest':
				policy.webRequest = parseLayerRules('webRequest', value, 'webRequest');
				break;
			case 'willNavigate':
				policy.willNavigate = parseLayerRules('willNavigate', value, 'willNavigate');
				break;
			case 'partitions':
				policy.partitions = parsePartitionRules(value);
				break;
			default:
				throw new PolicyError('FLAUZ_POLICY_SCHEMA', key, `unknown top-level key (allowed: schemaVersion, driver, webRequest, willNavigate, partitions)`);
		}
	}

	const warnings: string[] = [];
	for (const layer of POLICY_LAYERS) {
		if (!(policy[layer] as LayerRules).enabled) {
			warnings.push(`${layer} layer kill-switched (enabled=false): every deny must be carried by the remaining layers (B1c insurance)`);
		}
	}
	if (POLICY_LAYERS.every(layer => !(policy[layer] as LayerRules).enabled)) {
		warnings.push('ALL gate layers kill-switched: the engine is fail-closed (every navigation is denied with reason no-enabled-gate)');
	}
	return { policy, warnings };
}

export interface ResolvedPolicy {
	readonly policy: BrowserPolicy;
	readonly source: PolicySource;
	readonly error: PolicyError | undefined;
	readonly warnings: readonly string[];
}

/**
 * Resolves the effective policy from file text (or absence of a file).
 * FAIL-CLOSED: a missing file resolves to the builtin deny-all default; a
 * broken file ALSO resolves to the deny-all default while carrying the typed
 * error for surfacing.
 */
export function resolvePolicyText(text: string | undefined): ResolvedPolicy {
	if (text === undefined) {
		return { policy: DEFAULT_POLICY, source: 'builtin-default', error: undefined, warnings: ['no .flauz/browser-policy.json found: the builtin deny-all default is in effect (create one with the flauz.browser.setPolicy command)'] };
	}
	try {
		const parsed = parsePolicyText(text);
		return { policy: parsed.policy, source: 'workspace-file', error: undefined, warnings: parsed.warnings };
	} catch (err) {
		if (err instanceof PolicyError) {
			return { policy: DEFAULT_POLICY, source: 'builtin-default', error: err, warnings: [`policy file rejected (${err.code}): deny-all builtin default in effect`] };
		}
		throw err;
	}
}

// #endregion

// #region The engine

export interface EngineOptions {
	readonly policy?: BrowserPolicy;
	readonly source?: PolicySource;
	readonly sourceError?: PolicyError;
	readonly warnings?: readonly string[];
	readonly clock?: Clock;
}

/**
 * The layered policy engine. Immutable after construction: reloads happen by
 * constructing a new engine (the extension swaps the instance on file
 * changes; see src/extension.ts).
 */
export class BrowserPolicyEngine {
	private readonly policy: BrowserPolicy;
	private readonly clock: Clock;
	readonly source: PolicySource;
	readonly sourceError: PolicyError | undefined;
	readonly warnings: readonly string[];

	constructor(options: EngineOptions = {}) {
		this.policy = options.policy ?? DEFAULT_POLICY;
		this.source = options.source ?? 'builtin-default';
		this.sourceError = options.sourceError;
		this.warnings = options.warnings ?? [];
		this.clock = options.clock ?? (() => Date.now());
	}

	/** Convenience factory: resolve + construct in one step (fail-closed on bad text). */
	static fromPolicyText(text: string | undefined, options: Omit<EngineOptions, 'policy' | 'source' | 'sourceError' | 'warnings'> = {}): BrowserPolicyEngine {
		const resolved = resolvePolicyText(text);
		return new BrowserPolicyEngine({ ...options, policy: resolved.policy, source: resolved.source, sourceError: resolved.error, warnings: resolved.warnings });
	}

	get policyInEffect(): BrowserPolicy {
		return this.policy;
	}

	/** Layers on the navigation path for a given initiator (B1c firing model). */
	applicableLayers(initiator: NavigationInitiator): readonly PolicyLayer[] {
		return initiator === 'agent-tool' ? ['driver', 'webRequest'] : ['willNavigate', 'webRequest'];
	}

	private contextSuffix(): string {
		return this.sourceError === undefined ? '' : ` [policy file invalid: ${this.sourceError.code}]`;
	}

	/** Evaluates a single layer's rules (standalone audit/check surface). */
	checkLayer(layer: PolicyLayer, url: string, options: { initiator?: NavigationInitiator; ts?: number } = {}): PolicyVerdict {
		return evaluateLayerRules(layer, this.policy[layer] as LayerRules, url, {
			partition: undefined,
			workspaceRoot: undefined,
			initiator: options.initiator ?? 'agent-tool',
			ts: options.ts ?? this.clock(),
			policyVersion: this.policy.schemaVersion,
			policySource: this.source,
		});
	}

	/** Derives this engine's partition name for a workspace (plus optional agent). */
	derivePartition(workspaceRoot: string, agentId: string | undefined = undefined): string {
		return derivePartition(workspaceRoot, agentId, this.policy.partitions);
	}

	/**
	 * Combined evaluation: deny-at-any-layer wins. Consults the partition
	 * containment check (when a partition is provided) plus the layers on the
	 * initiator's path, in precedence order partition > driver > webRequest >
	 * willNavigate. When every gate layer on the path is kill-switched the
	 * verdict is a fail-closed deny attributed to 'policyFile'.
	 */
	evaluate(check: NavigationCheck): EvaluationResult {
		const ts = check.ts ?? this.clock();
		const policyContext = { initiator: check.initiator, ts, policyVersion: this.policy.schemaVersion, policySource: this.source };
		const verdicts: PolicyVerdict[] = [];
		if (check.partition !== undefined) {
			verdicts.push(checkPartition(check.partition, { workspaceRoot: check.workspaceRoot, expectedScope: this.policy.partitions.scope, ...policyContext }));
		}
		const gates = this.applicableLayers(check.initiator);
		const enabledGates = gates.filter(layer => (this.policy[layer] as LayerRules).enabled);
		for (const layer of gates) {
			const verdict = evaluateLayerRules(layer, this.policy[layer] as LayerRules, check.url, {
				partition: check.partition,
				workspaceRoot: check.workspaceRoot,
				...policyContext,
			});
			verdicts.push(verdict);
		}
		const firstDeny = verdicts.find(verdict => verdict.decision === 'deny');
		if (firstDeny !== undefined) {
			return { final: { ...firstDeny, reason: `${firstDeny.reason}${this.contextSuffix()}` }, layers: verdicts };
		}
		if (enabledGates.length === 0) {
			return {
				final: {
					decision: 'deny',
					layer: 'policyFile',
					reason: `fail-closed: every gate layer on the '${check.initiator}' path is kill-switched (${gates.join(', ')})${this.contextSuffix()}`,
					rule: undefined,
					url: check.url,
					partition: check.partition ?? '',
					initiator: check.initiator,
					policyVersion: this.policy.schemaVersion,
					policySource: this.source,
					ts,
				},
				layers: verdicts,
			};
		}
		const last = verdicts[verdicts.length - 1] as PolicyVerdict;
		return {
			final: { ...last, reason: `allowed at every consulted layer (${verdicts.map(verdict => verdict.layer).join(', ')})${this.contextSuffix()}` },
			layers: verdicts,
		};
	}

	/**
	 * Post-commit reconciliation (SECURITY-MODEL section 4 F2): after a
	 * navigation commits in an agent session, the final URL is re-checked
	 * against the webRequest layer; on violation the caller must force
	 * `about:blank` and record the verdict as evidence (the committed-URL
	 * residual from the Wave-1 probes: canceling content does not roll the
	 * URL back).
	 */
	reconcileCommittedUrl(url: string, options: { partition?: string; workspaceRoot?: string; ts?: number } = {}): ReconciliationResult {
		const ts = options.ts ?? this.clock();
		const verdict = evaluateLayerRules('webRequest', this.policy.webRequest as LayerRules, url, {
			partition: options.partition,
			workspaceRoot: options.workspaceRoot,
			initiator: 'agent-tool',
			ts,
			policyVersion: this.policy.schemaVersion,
			policySource: this.source,
		});
		const violation = verdict.decision === 'deny';
		return {
			violation,
			verdict: violation
				? { ...verdict, reason: `post-commit violation: ${verdict.reason} -- force about:blank and ledger the attempt${this.contextSuffix()}` }
				: verdict,
			resetTo: violation ? RESET_URL : undefined,
		};
	}
}

export interface ReconciliationResult {
	readonly violation: boolean;
	readonly verdict: PolicyVerdict;
	/** 'about:blank' when a violation was detected (the forced reset target). */
	readonly resetTo: string | undefined;
}

// #endregion

// #region Canonical serialization + evidence-row seam

/**
 * Canonical JSON: keys sorted recursively, no insignificant whitespace,
 * `undefined` dropped. Byte-identical algorithm to the flauz-workspace
 * envelope/ledger canonicalizer (extensions/flauz-workspace/src/api.ts) so
 * verdict artifacts hash consistently across the two extensions.
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
	throw new Error(`flauz.browser-policy: cannot canonicalize value of type ${typeof value} (payloads must be JSON-safe)`);
}

const SHA256_K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
	return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * Pure-TypeScript sha256 over the UTF-8 bytes of `input`, hex-encoded.
 *
 * Mirrors extensions/flauz-workspace/src/api.ts (kept local so the engine has
 * zero runtime deps and identical behavior under node --test and the
 * extension host); cross-checked against node:crypto in test/policy.test.ts.
 */
export function sha256Hex(input: string): string {
	const bytes = new TextEncoder().encode(input);
	const bitLength = bytes.length * 8;
	const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
	const padded = new Uint8Array(paddedLength);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296), false);
	view.setUint32(paddedLength - 4, bitLength >>> 0, false);

	let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
	let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

	const w = new Uint32Array(64);
	for (let block = 0; block < paddedLength; block += 64) {
		for (let i = 0; i < 16; i++) {
			w[i] = view.getUint32(block + i * 4, false);
		}
		for (let i = 16; i < 64; i++) {
			const s0 = rotr(w[i - 15] ?? 0, 7) ^ rotr(w[i - 15] ?? 0, 18) ^ ((w[i - 15] ?? 0) >>> 3);
			const s1 = rotr(w[i - 2] ?? 0, 17) ^ rotr(w[i - 2] ?? 0, 19) ^ ((w[i - 2] ?? 0) >>> 10);
			w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
		}
		let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const t1 = (h + S1 + ch + (SHA256_K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
			const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const t2 = (S0 + maj) >>> 0;
			h = g; g = f; f = e; e = (d + t1) >>> 0;
			d = c; c = b; b = a; a = (t1 + t2) >>> 0;
		}
		h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
		h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
	}

	return [h0, h1, h2, h3, h4, h5, h6, h7]
		.map(word => word.toString(16).padStart(8, '0'))
		.join('');
}

/**
 * The JSON-safe verdict core used for evidence hashing. `ts` is deliberately
 * dropped: the ledger row carries its own timestamp, and omitting it makes
 * identical outcomes hash identically (idempotent evidence).
 */
export function verdictCore(verdict: PolicyVerdict): Record<string, unknown> {
	return {
		decision: verdict.decision,
		initiator: verdict.initiator,
		layer: verdict.layer,
		partition: verdict.partition,
		policySource: verdict.policySource,
		policyVersion: verdict.policyVersion,
		reason: verdict.reason,
		rule: verdict.rule,
		url: verdict.url,
	};
}

/** Compact one-line summary for the ledger row note. */
export function verdictSummary(verdict: PolicyVerdict): string {
	return `${verdict.decision}/${verdict.layer} ${verdict.initiator} ${verdict.url} -- ${verdict.reason}`;
}

export interface EvidenceRowInput {
	readonly kind: 'note';
	readonly uri: string;
	readonly sha256: string;
	readonly note: string;
}

/**
 * Maps a verdict onto the flauz-workspace ledger row shape
 * (LedgerRowInput -- extensions/flauz-workspace/src/api.ts:63). The proposed
 * seam: the Agent Bridge calls
 * `flauz.workspace.appendEvidence { taskId, row }` with this row after
 * writing the canonical verdict artifact under `.flauz/artifacts/<taskId>/`
 * (DL-21 shape 5). Without a taskId the uri points at the verdict identity
 * itself (`flauz-policy://verdicts/<hash16>`).
 */
export function toEvidenceRow(verdict: PolicyVerdict, taskId: string | undefined): EvidenceRowInput {
	const hash = sha256Hex(canonicalJson(verdictCore(verdict)));
	const shortHash = hash.slice(0, WORKSPACE_HASH_LENGTH);
	const uri = taskId === undefined
		? `flauz-policy://verdicts/${shortHash}`
		: `.flauz/artifacts/${taskId}/browser-verdict-${shortHash}.json`;
	return { kind: 'note', uri, sha256: hash, note: verdictSummary(verdict) };
}

// #endregion

// #region Policy file template

function sortedPolicyRecord(policy: BrowserPolicy): Record<string, unknown> {
	const layerRecord = (rules: LayerRules): Record<string, unknown> => {
		const record: Record<string, unknown> = {};
		if (rules.allow.length > 0) {
			record['allow'] = [...rules.allow];
		}
		if (rules.deny.length > 0) {
			record['deny'] = [...rules.deny];
		}
		if (rules.fileRoots.length > 0) {
			record['fileRoots'] = [...rules.fileRoots];
		}
		if (!rules.enabled) {
			record['enabled'] = false;
		}
		return record;
	};
	const record: Record<string, unknown> = {
		schemaVersion: policy.schemaVersion,
		driver: layerRecord(policy.driver),
		webRequest: layerRecord(policy.webRequest),
		willNavigate: layerRecord(policy.willNavigate),
		partitions: { scope: policy.partitions.scope, perAgent: policy.partitions.perAgent },
	};
	return record;
}

function deepSortedRecord(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(deepSortedRecord);
	}
	if (value !== null && typeof value === 'object') {
		const source = value as Record<string, unknown>;
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(source).sort()) {
			result[key] = deepSortedRecord(source[key]);
		}
		return result;
	}
	return value;
}

/**
 * Serializes a policy with the `.flauz/` artifact discipline (DL-9): sorted
 * keys, 2-space indent, exactly one trailing newline. Byte-identical states
 * serialize identically. NOTE: repo-committed fixture files are TAB-indented
 * per repo hygiene; both forms parse identically (JSON.parse).
 */
export function serializePolicy(policy: BrowserPolicy): string {
	return JSON.stringify(deepSortedRecord(sortedPolicyRecord(policy)), null, 2) + '\n';
}

/** The starter template written by the flauz.browser.setPolicy command: deny-all defaults made explicit. */
export function policyTemplate(): string {
	return serializePolicy(DEFAULT_POLICY);
}

// #endregion
