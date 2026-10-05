/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * ZC-009 CLI/headless parity contracts: the command grammar (contract
 * module, the labContracts discipline).
 *
 * LAWS (ARCHITECTURE-LOCK.md 5, 10.2, 11; MASTER-ROADMAP.md Phase C):
 * - Contract set, not a CLI runtime: this module declares types,
 *   constants, pure guards and the PURE argv validator below. No bin/
 *   packaging, no process spawning, no arg-parsing runtime, no
 *   renderer, no network client - the runtime client is a later
 *   product wave; this wave pins its contract.
 * - PARITY IS PROJECTION: the grammar derives from the EXISTING service
 *   journeys (workspace, background-agent, workflow, approval,
 *   evidence, replay, lab, capability-discovery - the same journeys
 *   the VS Code surfaces expose). A CLI-only journey is
 *   UNREPRESENTABLE: the journey vocabulary is frozen to the service
 *   surface list, and the wire module pins the two lists equal.
 * - Closed vocabularies: journeys, per-journey command groups, arg
 *   kinds and parse-mismatch kinds are frozen as-const lists with
 *   derived unions, pinned by tests.
 * - Determinism: no Math.random, no Date.now, no new Date( ... ) calls
 *   in this module. Timestamps are plain ISO-8601 strings; durations
 *   are injected plain numbers.
 * - Zero-dependency: this module pulls in nothing from other modules.
 *   Shapes shared with sibling contract modules are re-declared there
 *   and pinned structurally by the test suite.
 * - Every persisted record carries scope (CliScope), contractVersion
 *   and plain-string ISO timestamps.
 *
 * SEAM(ARG_SPECS) - soft seam, reconcile repo-side: the per-command
 * argSpec triplets (name / required / argKind) below are MINIMAL
 * CONTRACT DECISIONS designed from the journey-command names this
 * order enumerates - the command table itself is order-given, the arg
 * specs are not authority values. Before productizing the runtime
 * client, reconcile them against the actual journey surfaces
 * (extensions/flauz-agent/src/types.ts + sessionsView.ts,
 * extensions/flauz-execution/src/contracts.ts, build/flauz/lab/), and
 * check the argKind vocabulary against the ZC-006 configuration
 * triplet style it mirrors. Summary digests are opaque placeholder
 * digests ('summary-digest:<command path>') pending real summary
 * digests. The guards and tests below hold for any reconciled table
 * of the same shape.
 */

/** Version of the CLI/headless parity contract set (all modules carry it). */
export const CLI_PARITY_CONTRACTS_VERSION = '1.0.0';

/** The frozen eight-journey vocabulary (the service surface list). */
export const CLI_JOURNEYS = [
    'workspace',
    'background-agent',
    'workflow',
    'approval',
    'evidence',
    'replay',
    'lab',
    'capability-discovery',
] as const;
export type CliJourney = (typeof CLI_JOURNEYS)[number];

/** Pure guard: a member of the frozen journey vocabulary. */
export function isCliJourney(value: unknown): value is CliJourney {
    return typeof value === 'string' && (CLI_JOURNEYS as readonly string[]).includes(value);
}

/** Frozen per-journey command groups (order-given, pinned by tests). */
export const WORKSPACE_COMMANDS = ['status', 'list', 'focus'] as const;
export const BACKGROUND_AGENT_COMMANDS = [
    'launch',
    'inspect',
    'message',
    'pause',
    'stop',
    'cancel',
    'resume',
    'roster',
] as const;
export const WORKFLOW_COMMANDS = ['phases', 'advance', 'view'] as const;
export const APPROVAL_COMMANDS = ['list', 'respond'] as const;
export const EVIDENCE_COMMANDS = ['attach', 'list', 'verify'] as const;
export const REPLAY_COMMANDS = ['plan', 'run', 'verify'] as const;
export const LAB_COMMANDS = ['runs', 'catalog', 'calibration', 'recommendations'] as const;
export const CAPABILITY_DISCOVERY_COMMANDS = ['sources', 'packs', 'search'] as const;

const COMMANDS_BY_JOURNEY: Readonly<Record<CliJourney, readonly string[]>> = {
    'workspace': WORKSPACE_COMMANDS,
    'background-agent': BACKGROUND_AGENT_COMMANDS,
    'workflow': WORKFLOW_COMMANDS,
    'approval': APPROVAL_COMMANDS,
    'evidence': EVIDENCE_COMMANDS,
    'replay': REPLAY_COMMANDS,
    'lab': LAB_COMMANDS,
    'capability-discovery': CAPABILITY_DISCOVERY_COMMANDS,
};

/** Closed arg-value vocabulary (mirrors the ZC-006 triplet style; see SEAM(ARG_SPECS)). */
export const CLI_ARG_KINDS = ['string', 'number', 'boolean', 'json'] as const;
export type CliArgKind = (typeof CLI_ARG_KINDS)[number];

/** Pure guard: a member of the closed arg-kind vocabulary. */
export function isCliArgKind(value: unknown): value is CliArgKind {
    return typeof value === 'string' && (CLI_ARG_KINDS as readonly string[]).includes(value);
}

/** One typed name/required/argKind triplet. */
export interface CliArgSpec {
    readonly name: string;
    readonly required: boolean;
    readonly argKind: CliArgKind;
}

/** One grammar entry: the typed contract of one journey command. */
export interface CliGrammarEntry {
    readonly journey: CliJourney;
    readonly command: string;
    /** Dotted plain command path: '<journey>.<command>'. */
    readonly path: string;
    readonly argSpec: readonly CliArgSpec[];
    /** Opaque digest over the command summary (see SEAM(ARG_SPECS)). */
    readonly summaryDigest: string;
}

/**
 * SEAM(ARG_SPECS): minimal contract decisions per command path (see the
 * module header for the reconciliation instruction). Keys cover exactly
 * the 29 order-given command paths.
 */
const ARG_SPECS_BY_PATH: Readonly<Record<string, readonly CliArgSpec[]>> = {
    'workspace.status': [],
    'workspace.list': [],
    'workspace.focus': [{ name: 'workspaceId', required: true, argKind: 'string' }],
    'background-agent.launch': [{ name: 'agentSpec', required: true, argKind: 'json' }],
    'background-agent.inspect': [{ name: 'agentId', required: true, argKind: 'string' }],
    'background-agent.message': [
        { name: 'agentId', required: true, argKind: 'string' },
        { name: 'message', required: true, argKind: 'string' },
    ],
    'background-agent.pause': [{ name: 'agentId', required: true, argKind: 'string' }],
    'background-agent.stop': [{ name: 'agentId', required: true, argKind: 'string' }],
    'background-agent.cancel': [{ name: 'agentId', required: true, argKind: 'string' }],
    'background-agent.resume': [{ name: 'agentId', required: true, argKind: 'string' }],
    'background-agent.roster': [],
    'workflow.phases': [{ name: 'workflowId', required: true, argKind: 'string' }],
    'workflow.advance': [
        { name: 'workflowId', required: true, argKind: 'string' },
        { name: 'phase', required: true, argKind: 'string' },
    ],
    'workflow.view': [{ name: 'workflowId', required: true, argKind: 'string' }],
    'approval.list': [],
    'approval.respond': [
        { name: 'approvalId', required: true, argKind: 'string' },
        { name: 'decision', required: true, argKind: 'string' },
    ],
    'evidence.attach': [
        { name: 'taskRef', required: true, argKind: 'string' },
        { name: 'evidence', required: true, argKind: 'json' },
    ],
    'evidence.list': [{ name: 'taskRef', required: true, argKind: 'string' }],
    'evidence.verify': [{ name: 'evidenceRef', required: true, argKind: 'string' }],
    'replay.plan': [{ name: 'sessionId', required: true, argKind: 'string' }],
    'replay.run': [{ name: 'planRef', required: true, argKind: 'string' }],
    'replay.verify': [{ name: 'runRef', required: true, argKind: 'string' }],
    'lab.runs': [{ name: 'limit', required: false, argKind: 'number' }],
    'lab.catalog': [],
    'lab.calibration': [{ name: 'calibrationId', required: false, argKind: 'string' }],
    'lab.recommendations': [{ name: 'limit', required: false, argKind: 'number' }],
    'capability-discovery.sources': [],
    'capability-discovery.packs': [{ name: 'sourceId', required: false, argKind: 'string' }],
    'capability-discovery.search': [
        { name: 'query', required: true, argKind: 'string' },
        { name: 'limit', required: false, argKind: 'number' },
    ],
};

function buildGrammar(): readonly CliGrammarEntry[] {
    const entries: CliGrammarEntry[] = [];
    for (const journey of CLI_JOURNEYS) {
        for (const command of COMMANDS_BY_JOURNEY[journey]) {
            const path = `${journey}.${command}`;
            const argSpec = ARG_SPECS_BY_PATH[path];
            entries.push({
                journey,
                command,
                path,
                argSpec: argSpec === undefined ? [] : argSpec,
                summaryDigest: `summary-digest:${path}`,
            });
        }
    }
    return Object.freeze(entries);
}

/** THE frozen journey-command table: 29 commands over the eight journeys. */
export const CLI_COMMAND_GRAMMAR: readonly CliGrammarEntry[] = buildGrammar();

/** Total command count (pinned by tests; 29 at this version). */
export const CLI_COMMAND_COUNT = CLI_COMMAND_GRAMMAR.length;

/** Pure query: the grammar entries of one journey group. Unknown journeys yield []. */
export function grammarFor(journey: CliJourney): readonly CliGrammarEntry[] {
    return CLI_COMMAND_GRAMMAR.filter((entry) => entry.journey === journey);
}

/** Pure query: the grammar entry for a dotted command path, or undefined. */
export function lookupGrammar(path: string): CliGrammarEntry | undefined {
    for (const entry of CLI_COMMAND_GRAMMAR) {
        if (entry.path === path) {
            return entry;
        }
    }
    return undefined;
}

/** Closed parse-mismatch vocabulary (typed verdicts; never an exception). */
export const CLI_PARSE_MISMATCH_KINDS = [
    'missing-argument',
    'unexpected-argument',
    'invalid-argument-value',
] as const;
export type CliParseMismatchKind = (typeof CLI_PARSE_MISMATCH_KINDS)[number];

export interface CliParsedArgs {
    readonly parsed: true;
    readonly args: Readonly<Record<string, string>>;
}

/** Typed mismatch: the closed kind, the named argument, the expected kind. */
export interface CliParseMismatch {
    readonly parsed: false;
    readonly kind: CliParseMismatchKind;
    readonly argName: string;
    readonly expected?: CliArgKind;
    readonly detail: string;
}

export type CliParseResult = CliParsedArgs | CliParseMismatch;

/**
 * PURE validator over an argv-shaped plain string list, positional in
 * argSpec order: required args must be present, optional args may be
 * absent (trailing), tokens are validated against their argKind, and
 * any extra token is a typed mismatch. Never throws - every failure is
 * a typed mismatch naming the expected (or offending) argument.
 */
export function parseSpec(entry: CliGrammarEntry, argv: readonly string[]): CliParseResult {
    const args: Record<string, string> = {};
    let index = 0;
    for (const spec of entry.argSpec) {
        if (index >= argv.length) {
            if (spec.required) {
                return mismatch(
                    'missing-argument',
                    spec.name,
                    spec.argKind,
                    `required argument '${spec.name}' (${spec.argKind}) is missing from the argv list`,
                );
            }
            continue;
        }
        const token = argv[index];
        index += 1;
        const valueViolation = argValueViolation(spec, token);
        if (valueViolation !== undefined) {
            return mismatch('invalid-argument-value', spec.name, spec.argKind, valueViolation);
        }
        args[spec.name] = token;
    }
    if (index < argv.length) {
        const extra = argv[index];
        return mismatch(
            'unexpected-argument',
            String(extra),
            undefined,
            `unexpected extra argument '${String(extra)}'; the grammar for '${entry.path}' declares ${entry.argSpec.length} arguments`,
        );
    }
    return { parsed: true, args };
}

function argValueViolation(spec: CliArgSpec, token: string): string | undefined {
    if (typeof token !== 'string') {
        return `argument '${spec.name}' must be a plain string token, got '${typeof token}'`;
    }
    switch (spec.argKind) {
        case 'string':
            return undefined;
        case 'number':
            if (token.length === 0 || !Number.isFinite(Number(token))) {
                return `argument '${spec.name}' must be a number, got '${token}'`;
            }
            return undefined;
        case 'boolean':
            if (token !== 'true' && token !== 'false') {
                return `argument '${spec.name}' must be 'true' or 'false', got '${token}'`;
            }
            return undefined;
        case 'json':
            if (!isValidJson(token)) {
                return `argument '${spec.name}' must be valid JSON, got '${token}'`;
            }
            return undefined;
    }
}

function isValidJson(token: string): boolean {
    if (token.length === 0) {
        return false;
    }
    try {
        JSON.parse(token);
        return true;
    } catch {
        return false;
    }
}

function mismatch(
    kind: CliParseMismatchKind,
    argName: string,
    expected: CliArgKind | undefined,
    detail: string,
): CliParseMismatch {
    return { parsed: false, kind, argName, expected, detail };
}