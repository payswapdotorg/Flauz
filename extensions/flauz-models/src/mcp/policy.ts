/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the MCP/tool integration posture (M5): POLICY
 * RECORDS ONLY.
 *
 * The native subsystems stay AUTHORITATIVE:
 *  - tools registered through the STABLE `vscode.lm.registerTool`
 *    (vscode.d.ts:20778) + listed in `vscode.lm.tools` + invoked through
 *    `vscode.lm.invokeTool` (native confirmation/invocation UX untouched);
 *  - MCP servers through the `contributes.mcpServerDefinitionProviders`
 *    contribution + `vscode.lm.registerMcpServerDefinitionProvider`
 *    (vscode.d.ts:20820-20843) and the contrib/mcp gateway surfaces
 *    (src/vs/workbench/contrib/mcp/: mcpGatewayService,
 *    mcpLanguageModelToolContribution, mcpRegistry/mcpService).
 *
 * Flauz adds exactly ONE thing on top: a durable policy record answering
 * "which agents may use which tools / MCP servers" -- consumed by the Flauz
 * agent runtime (Worker A) when it ASSEMBLES its tool sets for a request.
 * This seam NEVER re-gates the native UX: a human invoking a tool through
 * the editor does not pass through this policy; only Flauz-driven agent
 * tool-set assembly consults it. Fail closed: unknown agents and unmatched
 * tools are denied by default, with the verdict explained.
 *
 * Durable state: `.flauz/models/tool-policy.json`
 * (`flauz.tool-policy/v0`, canonical envelope, materialized from the
 * shipped default on first run, then user-owned; strict parsing -- typed
 * failures, never silently reinterpreted).
 */

import type { Clock, FileSystemPort } from '../contract/ports.ts';
import { atomicWrite, envelopeText, joinStatePath, readEnvelope, StateFileError } from '../discovery/stateFiles.ts';

/** Schema id pinned into the tool policy file. */
export const TOOL_POLICY_SCHEMA_ID = 'flauz.tool-policy/v0';

/** Typed tool-policy failure. */
export class ToolPolicyError extends Error {
	readonly code: 'STORE_CORRUPT' | 'WRITE_FAILED';

	constructor(code: 'STORE_CORRUPT' | 'WRITE_FAILED', message: string) {
		super(message);
		this.name = 'ToolPolicyError';
		this.code = code;
	}
}

/** Per-agent policy entry. */
export interface ToolPolicyAgentEntry {
	/** Verdict for tools that match no pattern in `tools`. */
	readonly default: 'allow' | 'deny';
	/** Tool-name patterns: exact ids or trailing-`*` prefixes (`*` = all tools). */
	readonly tools: readonly string[];
	/** MCP server-id patterns the agent may consume tools from (`*` = all). */
	readonly mcpServers: readonly string[];
}

/** The policy file envelope. */
export interface ToolPolicyFile {
	readonly schema: typeof TOOL_POLICY_SCHEMA_ID;
	readonly schemaVersion: 0;
	readonly updatedAt: number;
	readonly agents: Readonly<Record<string, ToolPolicyAgentEntry>>;
}

/**
 * The shipped default: the flauz-agent bridge gets the two Flauz-native
 * tools (terminal + browser families), NO MCP servers, and default-deny for
 * everything else. Other agents start empty and default-deny.
 */
export const DEFAULT_TOOL_POLICY: ToolPolicyFile = {
	schema: TOOL_POLICY_SCHEMA_ID,
	schemaVersion: 0,
	updatedAt: 0,
	agents: {
		'flauz-agent': {
			default: 'deny',
			tools: ['flauz_terminal', 'flauz_browser_*'],
			mcpServers: [],
		},
	},
};

/** One policy verdict (always explained; provenance for agent-side decisions). */
export interface ToolPolicyVerdict {
	readonly agentId: string;
	readonly toolName: string;
	readonly allowed: boolean;
	readonly basis: 'pattern-allow' | 'entry-default-allow' | 'entry-default-deny' | 'unknown-agent-deny';
	readonly matchedPattern?: string;
	readonly explanation: string;
}

/** Pattern match: exact, or trailing-`*` prefix (`*` alone matches everything). */
export function patternMatches(pattern: string, name: string): boolean {
	if (pattern === '*') {
		return true;
	}
	if (pattern.endsWith('*')) {
		return name.startsWith(pattern.slice(0, -1));
	}
	return pattern === name;
}

/** Validates one pattern (non-empty; `*` only as the final character). */
export function isValidPattern(pattern: string): boolean {
	if (pattern.length === 0) {
		return false;
	}
	const starIndex = pattern.indexOf('*');
	return starIndex === -1 || (starIndex === pattern.length - 1);
}

/**
 * Evaluates the policy for one agent + tool. FAIL CLOSED: an unknown agent
 * is denied; a known agent with no matching pattern gets the entry default
 * (deny unless explicitly allowed). The verdict always carries the basis
 * and a human explanation -- agent-side tool decisions are explainable.
 */
export function evaluateToolPolicy(policy: ToolPolicyFile, agentId: string, toolName: string): ToolPolicyVerdict {
	const entry = policy.agents[agentId];
	if (entry === undefined) {
		return {
			agentId,
			toolName,
			allowed: false,
			basis: 'unknown-agent-deny',
			explanation: `agent '${agentId}' has no tool-policy entry; denied (fail closed). Add an entry in .flauz/models/tool-policy.json to grant tools.`,
		};
	}
	for (const pattern of entry.tools) {
		if (patternMatches(pattern, toolName)) {
			return {
				agentId,
				toolName,
				allowed: true,
				basis: 'pattern-allow',
				matchedPattern: pattern,
				explanation: `tool '${toolName}' matches pattern '${pattern}' in agent '${agentId}'s tool policy.`,
			};
		}
	}
	if (entry.default === 'allow') {
		return {
			agentId,
			toolName,
			allowed: true,
			basis: 'entry-default-allow',
			explanation: `tool '${toolName}' matched no pattern but agent '${agentId}' defaults to allow.`,
		};
	}
	return {
		agentId,
		toolName,
		allowed: false,
		basis: 'entry-default-deny',
		explanation: `tool '${toolName}' matched no pattern and agent '${agentId}' defaults to deny.`,
	};
}

/** Evaluates whether an agent may consume tools from one MCP server id (same fail-closed posture). */
export function evaluateMcpServerPolicy(policy: ToolPolicyFile, agentId: string, serverId: string): ToolPolicyVerdict {
	const entry = policy.agents[agentId];
	if (entry === undefined) {
		return {
			agentId,
			toolName: `mcp:${serverId}`,
			allowed: false,
			basis: 'unknown-agent-deny',
			explanation: `agent '${agentId}' has no tool-policy entry; MCP server '${serverId}' denied (fail closed).`,
		};
	}
	for (const pattern of entry.mcpServers) {
		if (patternMatches(pattern, serverId)) {
			return {
				agentId,
				toolName: `mcp:${serverId}`,
				allowed: true,
				basis: 'pattern-allow',
				matchedPattern: pattern,
				explanation: `MCP server '${serverId}' matches pattern '${pattern}' in agent '${agentId}'s tool policy.`,
			};
		}
	}
	return {
		agentId,
		toolName: `mcp:${serverId}`,
		allowed: false,
		basis: entry.default === 'allow' ? 'entry-default-allow' : 'entry-default-deny',
		explanation: `MCP server '${serverId}' matched no pattern and agent '${agentId}' defaults to ${entry.default}.`,
	};
}

function parseAgentEntry(value: Record<string, unknown>, path: string, agentId: string): ToolPolicyAgentEntry {
	const defaultVerdict = value.default;
	if (defaultVerdict !== 'allow' && defaultVerdict !== 'deny') {
		throw new ToolPolicyError('STORE_CORRUPT', `${path}: agents['${agentId}'].default must be allow|deny`);
	}
	const readPatterns = (key: 'tools' | 'mcpServers'): string[] => {
		const raw = value[key];
		if (raw === undefined) {
			return [];
		}
		if (!Array.isArray(raw)) {
			throw new ToolPolicyError('STORE_CORRUPT', `${path}: agents['${agentId}'].${key} must be an array of patterns`);
		}
		const patterns: string[] = [];
		for (const entry of raw) {
			if (typeof entry !== 'string' || !isValidPattern(entry)) {
				throw new ToolPolicyError('STORE_CORRUPT', `${path}: agents['${agentId}'].${key} contains an invalid pattern (${String(entry)}) -- patterns are exact ids or trailing-* prefixes`);
			}
			patterns.push(entry);
		}
		return patterns;
	};
	return { default: defaultVerdict, tools: readPatterns('tools'), mcpServers: readPatterns('mcpServers') };
}

/** Parses a tool-policy file body (strict; typed failures). */
export function parseToolPolicy(text: string, path: string): ToolPolicyFile {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new ToolPolicyError('STORE_CORRUPT', `${path}: not valid JSON (${error instanceof Error ? error.message : String(error)})`);
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new ToolPolicyError('STORE_CORRUPT', `${path}: root is not an object`);
	}
	const envelope = parsed as Record<string, unknown>;
	if (envelope.schema !== TOOL_POLICY_SCHEMA_ID) {
		throw new ToolPolicyError('STORE_CORRUPT', `${path}: carries schema '${String(envelope.schema)}' but '${TOOL_POLICY_SCHEMA_ID}' was expected`);
	}
	const agentsRaw = envelope.agents;
	if (agentsRaw === null || typeof agentsRaw !== 'object' || Array.isArray(agentsRaw)) {
		throw new ToolPolicyError('STORE_CORRUPT', `${path}: field "agents" must be an object keyed by agent id`);
	}
	const agents: Record<string, ToolPolicyAgentEntry> = {};
	for (const [agentId, value] of Object.entries(agentsRaw as Record<string, unknown>)) {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			throw new ToolPolicyError('STORE_CORRUPT', `${path}: agents['${agentId}'] is not an object`);
		}
		agents[agentId] = parseAgentEntry(value as Record<string, unknown>, path, agentId);
	}
	return { schema: TOOL_POLICY_SCHEMA_ID, schemaVersion: 0, updatedAt: typeof envelope.updatedAt === 'number' ? envelope.updatedAt : 0, agents };
}

/**
 * Loads the tool policy; materializes the shipped default on first run
 * (then user-owned). Present-but-corrupt files fail closed with typed
 * errors -- never silently reinterpreted.
 */
export async function loadToolPolicy(fs: FileSystemPort, stateDir: string, clock: Clock): Promise<ToolPolicyFile> {
	const path = joinStatePath(stateDir, 'tool-policy.json');
	try {
		const envelope = await readEnvelope(fs, path, TOOL_POLICY_SCHEMA_ID);
		if (envelope === undefined) {
			const materialized: ToolPolicyFile = { ...DEFAULT_TOOL_POLICY, updatedAt: clock() };
			await atomicWrite(fs, path, envelopeText(materialized));
			return materialized;
		}
		return parseToolPolicy(JSON.stringify({ schema: envelope.schema, updatedAt: typeof envelope.updatedAt === 'number' ? envelope.updatedAt : 0, agents: envelope.agents ?? {} }), path);
	} catch (error) {
		if (error instanceof ToolPolicyError) {
			throw error;
		}
		if (error instanceof StateFileError) {
			throw new ToolPolicyError(error.code === 'STORE_CORRUPT' ? 'STORE_CORRUPT' : 'WRITE_FAILED', error.message);
		}
		throw new ToolPolicyError('WRITE_FAILED', `${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Writes a tool policy file (explicit authoring). */
export async function saveToolPolicy(fs: FileSystemPort, stateDir: string, policy: ToolPolicyFile): Promise<void> {
	try {
		await atomicWrite(fs, joinStatePath(stateDir, 'tool-policy.json'), envelopeText(policy));
	} catch (error) {
		throw new ToolPolicyError('WRITE_FAILED', `tool-policy.json: ${error instanceof Error ? error.message : String(error)}`);
	}
}
