/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W7 (the agent-with-tools dogfood lane) -- the REAL
 * tool-carrying surface both new exercises drive.
 *
 * THE PRODUCT'S OWN GOLDEN-PATH MACHINERY, verbatim (the same composition
 * extensions/flauz-agent/test/goldenPath.test.ts + takeover.p2fix204.test.ts
 * wire): the fidelity vscode mock (extensions/flauz-agent/test/harness/
 * vscode-mock.ts -- the sanctioned test-time cross-extension import) whose
 * `lm.invokeTool` implements the platform's HumanApproval gate (the tool's
 * REAL `prepareInvocation` -> `confirmationMessages` -> the confirmation
 * policy -> `invoke`), the REAL `flauz_terminal` tool (registerTerminalTool,
 * extensions/flauz-agent/src/tools/terminalTool.ts) -- and, where the
 * product's tests inject a fake terminal, THIS harness injects the
 * PRODUCTION-SHAPED one: a real `/bin/sh -c` child process on a real cwd
 * (the terminal factory the tool's own deps contract designs for injection).
 *
 * Nothing here reimplements a product seam: the tool implementation, the
 * confirmation gate semantics, the invocation recording and the denial
 * path ("rejected by user") are the product's own code; this module only
 * supplies the production-like terminal and mints the dogfood TOOL
 * RECEIPT (schema `flauz.dogfood-tool-receipt/v1`) for every invocation
 * that passed the gate -- the receipt contract the tools-exploration
 * answer must cite and the driver verifies (checked, never trusted).
 *
 * Harness module (build/flauz/dogfood/**): NOT a gate instrument.
 */

import { spawn } from 'node:child_process';
import { sha256Hex } from '../../../extensions/flauz-workspace/src/api.ts';
import { registerTerminalTool, TERMINAL_TOOL_ID, type TerminalFactory, type TerminalLike } from '../../../extensions/flauz-agent/src/tools/terminalTool.ts';
import { createMockVscode, type ConfirmationPolicy, type MockVscodeApi, type MockVscodeState } from '../../../extensions/flauz-agent/test/harness/vscode-mock.ts';

/** The pinned schema id of the dogfood tool receipt (the evidence every approved invocation mints). */
export const TOOL_RECEIPT_SCHEMA = 'flauz.dogfood-tool-receipt/v1';

/** One REAL terminal execution the surface performed (the production-shaped terminal's own record). */
export interface ToolExecutionRecord {
        readonly command: string;
        readonly stdout: string;
        readonly stderr: string;
        readonly exitCode: number;
        readonly durationMs: number;
        readonly at: number;
}

/** One confirmation-gate decision the mock asked (the HumanApproval surface's observable). */
export interface ConfirmationDecision {
        readonly tool: string;
        readonly title: string;
        readonly message: string;
        readonly command: string;
        readonly granted: boolean;
        readonly at: number;
}

/** The production-shaped terminal: `/bin/sh -c <command>` on a real cwd, output streamed back exactly as the tool reads it. */
export function createRealTerminalFactory(cwd: string, executions: ToolExecutionRecord[], logger?: (line: string) => void): TerminalFactory {
        return (name: string): TerminalLike => {
                return {
                        name,
                        get shellIntegration() {
                                return {
                                        executeCommand(commandLine: string) {
                                                return {
                                                        read() {
                                                                return (async function* stream() {
                                                                        const startedAt = Date.now();
                                                                        const child = spawn('/bin/sh', ['-c', commandLine], { cwd });
                                                                        let stdout = '';
                                                                        let stderr = '';
                                                                        child.stdout.on('data', chunk => {
                                                                                stdout += chunk.toString('utf-8');
                                                                        });
                                                                        child.stderr.on('data', chunk => {
                                                                                stderr += chunk.toString('utf-8');
                                                                        });
                                                                        const exitCode = await new Promise<number | null>(resolve => {
                                                                                child.on('close', code => resolve(code));
                                                                                child.on('error', () => resolve(-1));
                                                                        });
                                                                        executions.push({
                                                                                command: commandLine,
                                                                                stdout,
                                                                                stderr,
                                                                                exitCode: exitCode === null ? -1 : exitCode,
                                                                                durationMs: Date.now() - startedAt,
                                                                                at: startedAt,
                                                                        });
                                                                        if (exitCode !== 0) {
                                                                                logger?.(`real terminal: '${commandLine}' exited ${String(exitCode)} in ${cwd}`);
                                                                        }
                                                                        // the terminal's merged stream shape: stdout first, stderr after (the tool joins the chunks it reads)
                                                                        yield stdout + (stderr.length > 0 ? stderr : '');
                                                                })();
                                                        },
                                                };
                                        },
                                };
                        },
                        show() {
                                /* the production surface focuses the terminal; nothing to record here */
                        },
                        dispose() {
                                /* the tool disposes the terminal after every invocation */
                        },
                };
        };
}

/** The outcome of one invocation through the approved path (executed, or refused at the gate). */
export interface ToolInvocationOutcome {
        readonly ok: boolean;
        readonly kind: 'executed' | 'denied';
        /** The tool's own text result (the trimmed joined stream), when executed. */
        readonly output: string;
        /** The refusal error text, when denied at the confirmation gate. */
        readonly refusal: string | null;
        readonly execution: ToolExecutionRecord | undefined;
        readonly decision: ConfirmationDecision | undefined;
}

/** Extracts the tool's text result exactly the way the orchestrator does (the joined string content parts). */
function extractToolText(result: unknown): string {
        const content = (result as { content?: Array<{ value?: unknown }> }).content ?? [];
        return content
                .filter(part => part !== null && typeof part === 'object' && typeof (part as { value?: unknown }).value === 'string')
                .map(part => String((part as { value: string }).value))
                .join('');
}

export interface AgentToolSurface {
        readonly api: MockVscodeApi;
        readonly state: MockVscodeState;
        readonly terminalFactory: TerminalFactory;
        /** Every real terminal execution this surface performed (in order). */
        readonly executions: readonly ToolExecutionRecord[];
        /** Every confirmation-gate decision the mock asked (in order). */
        readonly decisions: readonly ConfirmationDecision[];
        /** Swaps the human-stand-in confirmation policy (the refusal/grant choreography). */
        setConfirmationPolicy(policy: ConfirmationPolicy): void;
        /** Invokes the REAL `flauz_terminal` tool through the platform gate (prepareInvocation -> confirmation -> invoke). */
        invokeTerminal(command: string): Promise<ToolInvocationOutcome>;
        dispose(): void;
}

export interface AgentToolSurfaceOptions {
        /** The cwd every command really executes in (the session workspace or the repo root). */
        readonly cwd: string;
        /** The human stand-in for the confirmation gate (the platform's Continue/Cancel). */
        readonly confirmationPolicy?: ConfirmationPolicy;
        readonly logger?: (line: string) => void;
}

/**
 * Boots the tool-carrying surface: the fidelity vscode mock + the REAL
 * `flauz_terminal` tool registered against it with the PRODUCTION-SHAPED
 * terminal factory. Every invocation passes the mock's HumanApproval gate
 * (the product's own invokeTool fidelity mapping) and really executes in
 * the cwd through `/bin/sh -c`.
 */
export function createAgentToolSurface(options: AgentToolSurfaceOptions): AgentToolSurface {
        const executions: ToolExecutionRecord[] = [];
        const decisions: ConfirmationDecision[] = [];
        let currentPolicy: ConfirmationPolicy = options.confirmationPolicy ?? (() => true);
        // the recording wrapper: every confirmation the gate asks is captured
        // verbatim (title + message + the decision) -- the receipt's approval row
        const recordingPolicy: ConfirmationPolicy = (toolName, confirmation) => {
                const granted = currentPolicy(toolName, confirmation);
                decisions.push({
                        tool: toolName,
                        title: confirmation.title,
                        message: confirmation.message,
                        command: '',
                        granted,
                        at: Date.now(),
                });
                return granted;
        };
        const { vscode: api, state } = createMockVscode({
                models: [{ vendor: 'flauz-mock', id: 'echo-1', family: 'flauz-echo', version: '1', name: 'Flauz Mock Echo' }],
                confirmationPolicy: recordingPolicy,
        });
        const terminalFactory = createRealTerminalFactory(options.cwd, executions, options.logger);
        const registration = registerTerminalTool((name, tool) => api.lm.registerTool(name, tool), {
                terminalFactory,
                logger: options.logger,
        });
        return {
                api,
                state,
                terminalFactory,
                get executions() {
                        return executions;
                },
                get decisions() {
                        return decisions;
                },
                setConfirmationPolicy(policy: ConfirmationPolicy) {
                        currentPolicy = policy;
                },
                async invokeTerminal(command: string): Promise<ToolInvocationOutcome> {
                        const execBefore = executions.length;
                        const decBefore = decisions.length;
                        try {
                                const result = await api.lm.invokeTool(TERMINAL_TOOL_ID, {
                                        toolInvocationToken: { opaque: true },
                                        input: { command },
                                });
                                const execution = executions.length > execBefore ? executions[executions.length - 1] : undefined;
                                const decision = decisions.length > decBefore ? decisions[decBefore] : undefined;
                                if (decision !== undefined && decision.command.length === 0) {
                                        decisions[decBefore] = { ...decision, command };
                                }
                                return {
                                        ok: true,
                                        kind: 'executed',
                                        output: extractToolText(result),
                                        refusal: null,
                                        execution,
                                        decision: decisions.length > decBefore ? decisions[decBefore] : undefined,
                                };
                        } catch (err) {
                                const message = err instanceof Error ? err.message : String(err);
                                const decision = decisions.length > decBefore ? decisions[decBefore] : undefined;
                                if (decision !== undefined && decision.command.length === 0) {
                                        decisions[decBefore] = { ...decision, command };
                                }
                                if (/rejected by user/.test(message)) {
                                        // the product's own HumanApproval refusal: the gate denied the invocation BEFORE execution
                                        return {
                                                ok: false,
                                                kind: 'denied',
                                                output: '',
                                                refusal: message,
                                                execution: undefined,
                                                decision: decisions.length > decBefore ? decisions[decBefore] : undefined,
                                        };
                                }
                                throw err;
                        }
                },
                dispose() {
                        registration.dispose();
                },
        };
}

/** The receipt's approval row (what the gate asked and how the human answered). */
export interface ToolReceiptApproval {
        readonly asked: boolean;
        readonly granted: boolean;
        readonly title: string;
        readonly message: string;
}

/** The receipt's execution row (the REAL terminal execution, when the gate granted it). */
export interface ToolReceiptExecution {
        readonly exitCode: number;
        readonly stdout: string;
        readonly stdoutSha256: string;
        readonly stdoutBytes: number;
        readonly durationMs: number;
}

/** The dogfood tool receipt: the durable record of ONE approved tool invocation. */
export interface ToolReceipt {
        readonly schema: 'flauz.dogfood-tool-receipt/v1';
        readonly receiptId: string;
        readonly tool: string;
        readonly input: { readonly command: string };
        readonly approval: ToolReceiptApproval;
        readonly execution: ToolReceiptExecution | null;
        readonly refusal: string | null;
        /** The ledger row that hash-pinned this receipt's transcript (minted by the exercise). */
        readonly evidence: { readonly evidenceId: string; readonly uri: string; readonly sha256: string } | null;
        readonly evidenceLevel: 'local-real';
        readonly ts: number;
}

export interface MintToolReceiptArgs {
        readonly receiptId: string;
        readonly command: string;
        readonly tool?: string;
        readonly decision?: ConfirmationDecision;
        readonly execution?: ToolExecutionRecord;
        readonly refusal?: string | null;
        readonly evidence?: { readonly evidenceId: string; readonly uri: string; readonly sha256: string };
        readonly ts?: number;
}

/** Builds one tool receipt (pure; the stdout is hashed + sized, the approval row comes from the captured decision). */
export function mintToolReceipt(args: MintToolReceiptArgs): ToolReceipt {
        const decision = args.decision;
        const approval: ToolReceiptApproval = decision === undefined
                ? { asked: false, granted: false, title: '', message: '' }
                : { asked: true, granted: decision.granted, title: decision.title, message: decision.message };
        const execution = args.execution === undefined ? null : {
                exitCode: args.execution.exitCode,
                stdout: args.execution.stdout,
                stdoutSha256: sha256Hex(args.execution.stdout),
                stdoutBytes: args.execution.stdout.length,
                durationMs: args.execution.durationMs,
        };
        return {
                schema: TOOL_RECEIPT_SCHEMA,
                receiptId: args.receiptId,
                tool: args.tool ?? TERMINAL_TOOL_ID,
                input: { command: args.command },
                approval,
                execution,
                refusal: args.refusal ?? null,
                evidence: args.evidence ?? null,
                evidenceLevel: 'local-real',
                ts: args.ts ?? Date.now(),
        };
}
