/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-010 (CLI/headless runtime) -- THE ENTRY.
 *
 * argv -> resolveGrammar -> parseSpec -> routeCommand -> responseFor
 *      -> exitCodeFor -> render (per renderSpec).
 *
 * LAWS:
 * - The ZC-009 contracts are the only vocabulary: every response is
 *   built by wire.ts's responseFor (the frozen refusal table; no
 *   free-form error strings on the response channel), every exit
 *   code comes from exitcodes.ts's exitCodeFor.
 * - HEADLESS: this client never prompts, never waits. Interactive-only
 *   surfaces surface as the typed 'headless-interactive-surface'
 *   refusal, disclosed (exitcodes.ts's non-interactive law).
 * - DETERMINISM: every output byte is a function of (argv, the
 *   workspace files, the injected issued-at). No Date.now, no
 *   Math.random. The issue timestamp is injected via --issued-at
 *   (default: the epoch constant); durationMs is injected as 0 and
 *   echoed verbatim (the wire builder never derives it).
 * - NOT A SECOND RUNTIME: all state is read through the service
 *   context port (runtime/context.ts); this file holds no models.
 * - Process-edge diagnostics (flag problems, typed parse mismatches,
 *   wire/render rejections, seam edge failures) print typed reasons to
 *   stderr and fail closed to exit 2 (the parse-layer code per
 *   exitcodes.ts's reconciliation note). They never fake success.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
        CLI_COMMAND_GRAMMAR,
        lookupGrammar,
        parseSpec,
        type CliGrammarEntry,
        type CliParseMismatch,
} from '../../zcode-patterns/cli/common/grammar.ts';
import {
        CLI_PARITY_CONTRACTS_VERSION,
        responseFor,
        type CliRequest,
        type CliResponse,
} from '../../zcode-patterns/cli/common/wire.ts';
import {
        EXIT_OK,
        EXIT_USAGE_ERROR,
        exitCodeFor,
        renderSpec,
        type OutputFormat,
        type RenderField,
} from '../../zcode-patterns/cli/common/exitcodes.ts';
import {
        canonicalJson,
        deriveScope,
        loadRealContext,
        sha256Hex,
        type CliContext,
} from '../runtime/context.ts';
import { routeCommand } from '../runtime/handlers.ts';

const DEFAULT_ISSUED_AT_ISO = '1970-01-01T00:00:00.000Z';
const INJECTED_DURATION_MS = 0;
const DEFAULT_ROOT = '.';
const VALUE_FLAGS: readonly string[] = ['--root', '--issued-at', '--workspace-id', '--tenant-id'];
const FORMAT_FLAGS: readonly string[] = ['--json', '--table', '--digest'];

export interface CliRunResult {
        readonly exitCode: number;
        readonly stdout: string;
        readonly stderr: string;
        readonly response?: CliResponse;
        readonly parseMismatch?: CliParseMismatch;
        readonly edgeFailure?: { reason: string; detail: string };
}

export interface RunCliOptions {
        context?: CliContext;
}

interface SplitArgv {
        positionals: string[];
        values: Record<string, string>;
        format: OutputFormat;
        help: boolean;
        problems: string[];
}

function splitArgv(argv: readonly string[]): SplitArgv {
        const positionals: string[] = [];
        const values: Record<string, string> = {};
        let format: OutputFormat = 'json';
        let help = false;
        const problems: string[] = [];
        for (let i = 0; i < argv.length; i++) {
                const token = argv[i];
                if (token === '--help') {
                        help = true;
                        continue;
                }
                if (FORMAT_FLAGS.includes(token)) {
                        format = token.slice(2) as OutputFormat;
                        continue;
                }
                if (VALUE_FLAGS.includes(token)) {
                        const valueToken = argv[i + 1];
                        if (valueToken === undefined) {
                                problems.push('flag ' + token + ' requires a value');
                                continue;
                        }
                        values[token.slice(2)] = valueToken;
                        i += 1;
                        continue;
                }
                if (token.startsWith('--')) {
                        problems.push('unknown flag ' + token);
                        continue;
                }
                positionals.push(token);
        }
        return { positionals, values, format, help, problems };
}

type EntryResolution =
        | { kind: 'entry'; entry: CliGrammarEntry; rest: string[] }
        | { kind: 'usage'; detail: string };

function resolveEntry(positionals: readonly string[]): EntryResolution {
        if (positionals.length === 0) {
                return { kind: 'usage', detail: 'no command given' };
        }
        const first = positionals[0];
        let path: string;
        let rest: string[];
        if (first.includes('.')) {
                path = first;
                rest = positionals.slice(1);
        } else {
                if (positionals.length < 2) {
                        return { kind: 'usage', detail: 'no command given' };
                }
                path = first + '.' + positionals[1];
                rest = positionals.slice(2);
        }
        const entry = lookupGrammar(path);
        if (entry === undefined) {
                return { kind: 'usage', detail: 'unknown command ' + path };
        }
        return { kind: 'entry', entry, rest };
}

function usageText(): string {
        const lines: string[] = [];
        lines.push('flauz - the headless CLI client (ZC-009 parity contracts ' + CLI_PARITY_CONTRACTS_VERSION + ')');
        lines.push('');
        lines.push('USAGE: flauz <journey>.<command> [args...] [--json|--table|--digest]');
        lines.push('       flauz <journey> <command> [args...]   (the two-token form is equivalent)');
        lines.push('       flauz [--root <path>] [--issued-at <iso>] [--workspace-id <id>] [--tenant-id <id>]');
        lines.push('       flauz --help');
        lines.push('');
        lines.push('Commands (' + String(lookupGrammarTable().length) + '):');
        for (const entry of lookupGrammarTable()) {
                const args = entry.argSpec
                        .map((spec) => (spec.required ? '<' + spec.name + '>' : '[<' + spec.name + '>]'))
                        .join(' ');
                lines.push('  ' + entry.path + (args.length > 0 ? ' ' + args : ''));
        }
        lines.push('');
        lines.push('Exit codes: 0 ok, 1 typed-refusal, 2 usage-error (parse layer), 3 not-found, 4 partial.');
        return lines.join('\n') + '\n';
}

function lookupGrammarTable(): readonly CliGrammarEntry[] {
        // Local re-export seam so usageText stays pure over the frozen table.
        return CLI_COMMAND_GRAMMAR;
}

function renderParseMismatch(mismatch: CliParseMismatch): string {
        const expected = mismatch.expected === undefined ? '' : ' (expected ' + mismatch.expected + ')';
        return (
                'flauz: parse ' + mismatch.kind + ': ' + mismatch.argName + expected + ': ' + mismatch.detail + '\n' +
                usageText()
        );
}

function fieldValue(response: CliResponse, field: RenderField): unknown {
        switch (field) {
                case 'scope':
                        return { workspaceId: response.scope.workspaceId, tenantId: response.scope.tenantId };
                case 'contractVersion':
                        return response.contractVersion;
                case 'requestId':
                        return response.requestId;
                case 'commandPath':
                        return response.commandPath;
                case 'outcome':
                        return response.outcome;
                case 'durationMs':
                        return response.durationMs;
                case 'resultDigest':
                        return (response as { resultDigest?: string }).resultDigest ?? '';
                case 'refusalCode':
                        return (response as { refusalCode?: string }).refusalCode ?? '';
                case 'violatedLaw':
                        return (response as { violatedLaw?: string }).violatedLaw ?? '';
        }
}

function responseRecord(response: CliResponse, fields: readonly RenderField[]): Record<string, unknown> {
        const record: Record<string, unknown> = {};
        for (const field of fields) {
                record[field] = fieldValue(response, field);
        }
        return record;
}

function canonicalResponseFields(response: CliResponse): readonly RenderField[] {
        const jsonSpec = renderSpec('json', response);
        return jsonSpec.built ? jsonSpec.spec.requiredFields : [];
}

function renderValue(record: Record<string, unknown>, field: string): string {
        const value = record[field];
        if (value === undefined || value === null) {
                return '';
        }
        if (typeof value === 'object') {
                return canonicalJson(value);
        }
        return String(value);
}

export function renderOutput(response: CliResponse, format: OutputFormat): string {
        const spec = renderSpec(format, response);
        if (!spec.built) {
                return 'flauz: render-rejection: ' + spec.reason + ': ' + spec.detail + '\n';
        }
        if (format === 'json') {
                return JSON.stringify(responseRecord(response, spec.spec.requiredFields), null, 2) + '\n';
        }
        if (format === 'table') {
                const record = responseRecord(response, spec.spec.requiredFields);
                const rows = spec.spec.requiredFields.map((field) => {
                        const value = renderValue(record, field);
                        return value.length === 0 ? field : field.padEnd(16) + value;
                });
                return rows.join('\n') + '\n';
        }
        // digest format: sha256 hex of the canonical JSON of the response record.
        return sha256Hex(canonicalJson(responseRecord(response, canonicalResponseFields(response)))) + '\n';
}

export async function runCli(argv: readonly string[], options?: RunCliOptions): Promise<CliRunResult> {
        const split = splitArgv(argv);
        if (split.problems.length > 0) {
                return {
                        exitCode: EXIT_USAGE_ERROR,
                        stdout: '',
                        stderr: 'flauz: ' + split.problems.join('; ') + '\n' + usageText(),
                };
        }
        if (split.help) {
                return { exitCode: EXIT_OK, stdout: usageText(), stderr: '' };
        }
        const resolution = resolveEntry(split.positionals);
        if (resolution.kind === 'usage') {
                return {
                        exitCode: EXIT_USAGE_ERROR,
                        stdout: '',
                        stderr: 'flauz: ' + resolution.detail + '\n' + usageText(),
                };
        }
        const parsed = parseSpec(resolution.entry, resolution.rest);
        if (!parsed.parsed) {
                return {
                        exitCode: EXIT_USAGE_ERROR,
                        stdout: '',
                        stderr: renderParseMismatch(parsed),
                        parseMismatch: parsed,
                };
        }
        // An injected context owns the root when present (the harness-backed
        // suite); an explicit --root still wins, and the isolation check in
        // routeCommand derives the same scope from context.root, so both agree.
        const root = resolve(split.values['root'] ?? options?.context?.root ?? DEFAULT_ROOT);
        const issuedAtIso = split.values['issued-at'] ?? DEFAULT_ISSUED_AT_ISO;
        const derived = deriveScope(root);
        const scope = {
                workspaceId: split.values['workspace-id'] ?? derived.workspaceId,
                tenantId: split.values['tenant-id'] ?? derived.tenantId,
        };
        const requestId =
                'cli-' +
                sha256Hex(
                        scope.workspaceId + '|' + scope.tenantId + '|' + resolution.entry.path + '|' +
                                canonicalJson(parsed.args) + '|' + issuedAtIso,
                ).slice(0, 24);
        const request: CliRequest = {
                scope,
                contractVersion: CLI_PARITY_CONTRACTS_VERSION,
                commandPath: resolution.entry.path,
                args: { ...parsed.args },
                requestId,
                issuedAtIso,
        };
        const context = options?.context ?? (await loadRealContext({ root, issuedAtIso }));
        const routed = await routeCommand(context, request);
        if (routed.kind === 'edge-failure') {
                return {
                        exitCode: EXIT_USAGE_ERROR,
                        stdout: '',
                        stderr: 'flauz: ' + routed.reason + ': ' + routed.detail,
                        edgeFailure: { reason: routed.reason, detail: routed.detail },
                };
        }
        const built = responseFor(request, routed.projection, INJECTED_DURATION_MS);
        if (!built.built) {
                return {
                        exitCode: EXIT_USAGE_ERROR,
                        stdout: '',
                        stderr: 'flauz: wire-rejection: ' + built.reason + ': ' + built.detail,
                        edgeFailure: { reason: built.reason, detail: built.detail },
                };
        }
        const response = built.response;
        return {
                exitCode: exitCodeFor(response),
                stdout: renderOutput(response, split.format),
                stderr: '',
                response,
        };
}

export async function main(): Promise<void> {
        const result = await runCli(process.argv.slice(2));
        if (result.stdout.length > 0) {
                process.stdout.write(result.stdout);
        }
        if (result.stderr.length > 0) {
                process.stderr.write(result.stderr);
        }
        process.exit(result.exitCode);
}

// Direct-run guard: importing this module (the journey battery's J6 legs)
// never executes the CLI; only `node --experimental-strip-types bin/flauz.ts` does.
const isDirectRun =
        process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
        void main();
}