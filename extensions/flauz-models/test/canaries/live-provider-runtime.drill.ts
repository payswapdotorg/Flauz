/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-H1 -- the LIVE-PROVIDER runtime verification drill.
 *
 * Verifies, against a REAL vendor endpoint through the REAL adapter seam
 * (src/adapters/openAiCompat.ts createOpenAiCompatAdapter -- the same code
 * path the fabric wires), the four behaviors the fixture suite can only
 * simulate:
 *
 *   routing       a minimal chat completion routes: 2xx + non-empty output +
 *                 the model id echoed on the wire matches the requested one
 *                 (a dated-snapshot `-YYYY-MM-DD` suffix is accepted; sibling
 *                 ids like `-mini` / `.1` / `-5-sonnet` are NOT).
 *   auth-failure  a deliberately-invalid credential is rejected with a TYPED
 *                 AUTH_FAILED / PERMISSION_DENIED error. A 2xx completion
 *                 under the invalid credential FAILS the row (no-silent-
 *                 success law); an untyped throw FAILS the row too.
 *   retry         a request under a 1 ms wall-clock budget aborts every
 *                 attempt into the typed TIMEOUT class (retryable,
 *                 short-backoff); the bounded window from the environments
 *                 lifecycle retry contract must exhaust TYPED at the bound
 *                 (default 3): never an infinite loop, never a silent
 *                 recovery (a completion under the 1 ms budget FAILs the
 *                 row). A live endpoint cannot be forced to return 429/5xx
 *                 on demand -- the wall-clock abort is the deterministic
 *                 retryable class this row can actually provoke.
 *   provenance    response id / request-id headers / the wire-echoed model /
 *                 usage are captured into the row detail, and the full
 *                 serialized row is swept against the redaction law.
 *
 * VENDOR-NEUTRAL env contract (the ONLY inputs this drill reads; it opens no
 * files -- the five process variables below are its entire input surface):
 *   required  FLAUZ_LIVE_PROVIDER_BASE_URL   OpenAI-compatible base (e.g. https://host/v1)
 *             FLAUZ_LIVE_PROVIDER_API_KEY    vault value; sent ONLY as the Bearer header
 *             FLAUZ_LIVE_PROVIDER_MODEL      the model id to verify
 *   optional  FLAUZ_LIVE_PROVIDER_HEADERS_JSON         extra headers, merged UNDER adapter headers
 *             FLAUZ_LIVE_PROVIDER_INVALID_HEADERS_JSON  overrides, merged OVER (auth-failure row only)
 *
 * SKIP law: any missing/blank required variable -> EVERY row SKIPs (the
 * reason names the missing variables), exit code 0, ZERO network traffic. A
 * missing optional variable skips ONLY its dependent row
 * (FLAUZ_LIVE_PROVIDER_INVALID_HEADERS_JSON -> the auth-failure row); a
 * missing optional never fails anything. A malformed optional JSON also
 * only skips (the reason names the variable; the raw value is never echoed).
 *
 * REDACTION law: no env VALUE (the API key, any header value from either
 * JSON variable) ever appears in any output, log or error -- not even
 * truncated or prefixed. Row details carry only status/class/code/name
 * facts; error MESSAGES are never emitted. Every serialized row is swept
 * against the env values: a hit replaces the detail with the pinned
 * suppression marker and FAILS the row.
 *
 * Envelope -- one JSONL line per row on stdout (stdout carries NOTHING but
 * these lines), exact key order:
 *   {"envelope":"flauz.live-provider-drill/v1","row":"routing|auth-failure|retry|provenance",
 *    "status":"pass|fail|skip","detail":{...},"startedAt":"<ISO8601>","durationMs":<int>}
 *
 * Observability: an observing HttpPort tee wraps the injected inner port
 * (nodeHttpPort on the CLI path; the drill never bypasses the port seam and
 * never calls fetch itself). The tee records request-header NAMES (never
 * values), the response status, the whitelisted request-id header family,
 * chunk/frame counts, and the first SSE frame's id/model plus the wire usage
 * -- the wire-level provenance the adapter surface does not expose.
 *
 * Retry semantics are IMPORTED from the environments lifecycle contract
 * (extensions/flauz-environments/src/lifecycle/providerRetry.ts -- the
 * semantic source of truth, replicated nowhere): resolveRetryBound /
 * isRetryableProviderStatus / providerRetryWaitMs / defaultRetryWait /
 * PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT / PROVIDER_RETRY_FIXED_DELAY_MS.
 * Engagement law: a typed error carrying an HTTP status engages the window
 * iff isRetryableProviderStatus(status) (429 + 5xx only); a transport-class
 * typed error (TIMEOUT / NETWORK_ERROR -- no status) engages per its own
 * pinned retry posture (RETRY_POLICY: retryable, short-backoff).
 *
 * Exit codes: 0 = every row passed or skipped (including the all-SKIP
 * no-env run); 1 = any row failed (or the harness itself failed). The drill
 * is honest scope: it never fabricates credentials, never contacts any
 * endpoint other than FLAUZ_LIVE_PROVIDER_BASE_URL, and stores nothing.
 *
 * The sibling contract test (test/live-provider-drill.contract.test.ts)
 * drives these same exported runners with in-memory stub ports and a
 * tripwire HttpPort: zero network by construction. This file run directly
 * (`node .../live-provider-runtime.drill.ts`) is the LIVE drill.
 */

import { createHash } from 'node:crypto';

import { createOpenAiCompatAdapter } from '../../src/adapters/openAiCompat.ts';
import { SseStreamParser } from '../../src/adapters/common.ts';
import { nodeHttpPort } from '../../src/contract/nodePorts.ts';
import { isProviderError } from '../../src/contract/errors.ts';
import type { HttpPort, HttpPortRequest, HttpPortResponse, SecretResolverPort } from '../../src/contract/ports.ts';
import type { ChatRequest, FinishReason, ModelDescriptor, ProviderAdapter, ResponseProvenance, TokenUsage } from '../../src/contract/types.ts';

import { PROVIDER_RETRY_FIXED_DELAY_MS, PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT, defaultRetryWait, isRetryableProviderStatus, providerRetryWaitMs, resolveRetryBound } from '../../../flauz-environments/src/lifecycle/providerRetry.ts';

// ---------------------------------------------------------------------------
// The env contract.
// ---------------------------------------------------------------------------

/** The five env variables this drill reads -- and nothing else. */
export const LIVE_PROVIDER_ENV = {
        baseUrl: 'FLAUZ_LIVE_PROVIDER_BASE_URL',
        apiKey: 'FLAUZ_LIVE_PROVIDER_API_KEY',
        model: 'FLAUZ_LIVE_PROVIDER_MODEL',
        headersJson: 'FLAUZ_LIVE_PROVIDER_HEADERS_JSON',
        invalidHeadersJson: 'FLAUZ_LIVE_PROVIDER_INVALID_HEADERS_JSON',
} as const;

/** The raw env snapshot the drill derives everything from. */
export interface DrillEnv {
        readonly baseUrl?: string;
        readonly apiKey?: string;
        readonly model?: string;
        readonly headersJson?: string;
        readonly invalidHeadersJson?: string;
}

export function readDrillEnv(env: Record<string, string | undefined>): DrillEnv {
        return {
                baseUrl: env[LIVE_PROVIDER_ENV.baseUrl],
                apiKey: env[LIVE_PROVIDER_ENV.apiKey],
                model: env[LIVE_PROVIDER_ENV.model],
                headersJson: env[LIVE_PROVIDER_ENV.headersJson],
                invalidHeadersJson: env[LIVE_PROVIDER_ENV.invalidHeadersJson],
        };
}

/** Optional-header JSON parse outcome (never a throw; never echoes the value). */
export interface HeaderJsonParse {
        readonly status: 'absent' | 'ok' | 'malformed';
        readonly headers: Readonly<Record<string, string>>;
}

export function parseHeaderJson(value: string | undefined): HeaderJsonParse {
        if (value === undefined || value.trim().length === 0) {
                return { status: 'absent', headers: {} };
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(value);
        } catch {
                return { status: 'malformed', headers: {} };
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                return { status: 'malformed', headers: {} };
        }
        const headers: Record<string, string> = {};
        for (const [name, headerValue] of Object.entries(parsed as Record<string, unknown>)) {
                if (name.trim().length === 0 || typeof headerValue !== 'string') {
                        return { status: 'malformed', headers: {} };
                }
                headers[name] = headerValue;
        }
        return { status: 'ok', headers };
}

// ---------------------------------------------------------------------------
// The rows + the SKIP law (plan).
// ---------------------------------------------------------------------------

export type RowName = 'routing' | 'auth-failure' | 'retry' | 'provenance';

/** Row order is pinned: the JSONL transcript always carries these four rows in this order. */
export const DRILL_ROWS: readonly RowName[] = ['routing', 'auth-failure', 'retry', 'provenance'];

export interface RowPlan {
        readonly row: RowName;
        readonly status: 'run' | 'skip';
        readonly reason?: string;
}

function isBlank(value: string | undefined): boolean {
        return value === undefined || value.trim().length === 0;
}

function missingRequired(env: DrillEnv): string[] {
        const missing: string[] = [];
        if (isBlank(env.baseUrl)) {
                missing.push(LIVE_PROVIDER_ENV.baseUrl);
        }
        if (isBlank(env.apiKey)) {
                missing.push(LIVE_PROVIDER_ENV.apiKey);
        }
        if (isBlank(env.model)) {
                missing.push(LIVE_PROVIDER_ENV.model);
        }
        return missing;
}

/**
 * The SKIP law, as a pure plan. Missing required env -> every row skips with
 * a reason naming the missing variables. Missing/malformed optional env ->
 * only the dependent row skips, and never as a failure.
 */
export function planRows(env: DrillEnv): RowPlan[] {
        const missing = missingRequired(env);
        if (missing.length > 0) {
                const reason = `missing required env: ${missing.join(', ')}`;
                return DRILL_ROWS.map(row => ({ row, status: 'skip', reason }));
        }
        const headers = parseHeaderJson(env.headersJson);
        if (headers.status === 'malformed') {
                const reason = `${LIVE_PROVIDER_ENV.headersJson} is present but is not a JSON object of string header values`;
                return DRILL_ROWS.map(row => ({ row, status: 'skip', reason }));
        }
        const invalid = parseHeaderJson(env.invalidHeadersJson);
        return DRILL_ROWS.map((row: RowName): RowPlan => {
                if (row === 'auth-failure') {
                        if (invalid.status === 'absent') {
                                return { row, status: 'skip', reason: `missing optional env: ${LIVE_PROVIDER_ENV.invalidHeadersJson} (only the auth-failure row needs it)` };
                        }
                        if (invalid.status === 'malformed') {
                                return { row, status: 'skip', reason: `${LIVE_PROVIDER_ENV.invalidHeadersJson} is present but is not a JSON object of string header values (the auth-failure row is skipped)` };
                        }
                        if (Object.keys(invalid.headers).length === 0) {
                                return { row, status: 'skip', reason: `${LIVE_PROVIDER_ENV.invalidHeadersJson} parsed to an empty object; nothing to invalidate (the auth-failure row is skipped)` };
                        }
                        return { row, status: 'run' };
                }
                return { row, status: 'run' };
        });
}

// ---------------------------------------------------------------------------
// The envelope + the redaction law.
// ---------------------------------------------------------------------------

export const DRILL_ENVELOPE_ID = 'flauz.live-provider-drill/v1';

/** The pinned detail replacement when the redaction sweep hits an env value. */
export const REDACTION_SUPPRESSED_DETAIL = 'redaction-law hit: an env-contract value appeared in the serialized row detail; the detail is suppressed and the row is failed';

export interface DrillRowEnvelope {
        readonly envelope: typeof DRILL_ENVELOPE_ID;
        readonly row: RowName;
        readonly status: 'pass' | 'fail' | 'skip';
        readonly detail: unknown;
        readonly startedAt: string;
        readonly durationMs: number;
}

/** Exact key order: envelope, row, status, detail, startedAt, durationMs. */
export function buildEnvelope(row: RowName, status: 'pass' | 'fail' | 'skip', detail: unknown, startedAt: string, durationMs: number): DrillRowEnvelope {
        return {
                envelope: DRILL_ENVELOPE_ID,
                row,
                status,
                detail,
                startedAt,
                durationMs: Math.max(0, Math.round(durationMs)),
        };
}

/**
 * Serializes one row and flags whether any secret appears in the line. This
 * is the DETECTOR; the emission law (suppress + fail) lives in finalizeRow.
 */
export function serializeDrillRow(envelope: DrillRowEnvelope, secrets: readonly string[]): { readonly line: string; readonly leaked: boolean } {
        let line: string;
        try {
                line = JSON.stringify(envelope);
        } catch {
                line = JSON.stringify(buildEnvelope(envelope.row, 'fail', { outcome: 'detail-unserializable' }, envelope.startedAt, envelope.durationMs));
        }
        const leaked = secrets.some(secret => secret.length > 0 && line.includes(secret));
        return { line, leaked };
}

/** The emission law: serialize; on a leak, fail the row with the suppressed marker detail. */
export function finalizeRow(row: RowName, status: 'pass' | 'fail' | 'skip', detail: unknown, startedAt: string, durationMs: number, secrets: readonly string[]): { readonly line: string; readonly status: 'pass' | 'fail' | 'skip' } {
        const first = serializeDrillRow(buildEnvelope(row, status, detail, startedAt, durationMs), secrets);
        if (!first.leaked) {
                return { line: first.line, status };
        }
        const suppressed = serializeDrillRow(buildEnvelope(row, 'fail', REDACTION_SUPPRESSED_DETAIL, startedAt, durationMs), []);
        return { line: suppressed.line, status: 'fail' };
}

/** Error facts WITHOUT any message text (the redaction law for errors: status/class/code/name only). */
function errorFacts(error: unknown): Record<string, unknown> {
        if (isProviderError(error)) {
                return {
                        code: error.code,
                        name: error.name,
                        ...(error.status === undefined ? {} : { status: error.status }),
                        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
                        retryable: error.retryable,
                        retryClass: error.retryClass,
                };
        }
        return { name: error instanceof Error ? error.name : typeof error };
}

// ---------------------------------------------------------------------------
// The observing HttpPort tee.
// ---------------------------------------------------------------------------

/** Response headers that are provenance (safe to record; never credential material). */
const REQUEST_ID_HEADERS: ReadonlySet<string> = new Set([
        'x-request-id',
        'request-id',
        'openai-request-id',
        'openai-processing-ms',
        'anthropic-request-id',
        'cf-request-id',
        'x-amzn-requestid',
        'apigw-requestid',
]);

/** What the tee observed on one wire exchange (no header VALUES, no bodies). */
export interface WireObservation {
        readonly method: string;
        readonly requestHeaderNames: readonly string[];
        readonly status: number | undefined;
        readonly responseHeaders: Readonly<Record<string, string>>;
        readonly chunkCount: number;
        readonly sseFrameCount: number;
        readonly responseId: string | undefined;
        readonly wireModel: string | undefined;
        readonly wireUsage: { readonly promptTokens?: number; readonly completionTokens?: number } | undefined;
}

interface ObservationDraft {
        method: string;
        requestHeaderNames: string[];
        status: number | undefined;
        responseHeaders: Record<string, string>;
        chunkCount: number;
        sseFrameCount: number;
        responseId: string | undefined;
        wireModel: string | undefined;
        wireUsage: { promptTokens?: number; completionTokens?: number } | undefined;
        text: string;
        recorded: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
        return typeof value === 'string' ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Parses the accumulated wire text into the frame-level provenance fields. */
function finalizeObservation(draft: ObservationDraft): void {
        const parser = new SseStreamParser();
        const frames = parser.feed(`${draft.text}\n\n`);
        for (const frame of frames) {
                if (frame.data === '[DONE]' || frame.data.trim().length === 0) {
                        continue;
                }
                draft.sseFrameCount++;
                let parsed: Record<string, unknown> | undefined;
                try {
                        parsed = asRecord(JSON.parse(frame.data));
                } catch {
                        parsed = undefined;
                }
                if (parsed === undefined) {
                        continue;
                }
                const id = asString(parsed['id']);
                if (draft.responseId === undefined && id !== undefined) {
                        draft.responseId = id;
                }
                const model = asString(parsed['model']);
                if (draft.wireModel === undefined && model !== undefined) {
                        draft.wireModel = model;
                }
                const usage = asRecord(parsed['usage']);
                if (usage !== undefined) {
                        const promptTokens = asFiniteNumber(usage['prompt_tokens']);
                        const completionTokens = asFiniteNumber(usage['completion_tokens']);
                        if (promptTokens !== undefined || completionTokens !== undefined) {
                                draft.wireUsage = {
                                        ...(promptTokens === undefined ? {} : { promptTokens }),
                                        ...(completionTokens === undefined ? {} : { completionTokens }),
                                };
                        }
                }
        }
}

function snapshotObservation(draft: ObservationDraft): WireObservation {
        return {
                method: draft.method,
                requestHeaderNames: [...draft.requestHeaderNames],
                status: draft.status,
                responseHeaders: { ...draft.responseHeaders },
                chunkCount: draft.chunkCount,
                sseFrameCount: draft.sseFrameCount,
                responseId: draft.responseId,
                wireModel: draft.wireModel,
                wireUsage: draft.wireUsage === undefined ? undefined : { ...draft.wireUsage },
        };
}

/**
 * The observing tee. Header merge law: `extras` ride UNDER the adapter's own
 * headers (the env-key vault Authorization always wins); `overrides` ride
 * OVER everything (the auth-failure row's deliberately-invalid credential).
 */
export function observingHttpPort(inner: HttpPort, extras: Readonly<Record<string, string>>, overrides: Readonly<Record<string, string>>): { readonly port: HttpPort; readonly observations: readonly WireObservation[] } {
        const observations: WireObservation[] = [];
        const port: HttpPort = {
                async request(request: HttpPortRequest): Promise<HttpPortResponse> {
                        const headers: Record<string, string> = { ...extras, ...(request.headers ?? {}), ...overrides };
                        const draft: ObservationDraft = {
                                method: request.method,
                                requestHeaderNames: Object.keys(headers),
                                status: undefined,
                                responseHeaders: {},
                                chunkCount: 0,
                                sseFrameCount: 0,
                                responseId: undefined,
                                wireModel: undefined,
                                wireUsage: undefined,
                                text: '',
                                recorded: false,
                        };
                        const record = (): void => {
                                if (draft.recorded) {
                                        return;
                                }
                                draft.recorded = true;
                                finalizeObservation(draft);
                                observations.push(snapshotObservation(draft));
                        };
                        let response: HttpPortResponse;
                        try {
                                response = await inner.request({ ...request, headers });
                        } catch (error) {
                                record();
                                throw error;
                        }
                        draft.status = response.status;
                        for (const [name, value] of Object.entries(response.headers)) {
                                if (REQUEST_ID_HEADERS.has(name)) {
                                        draft.responseHeaders[name] = value;
                                }
                        }
                        return {
                                status: response.status,
                                statusText: response.statusText,
                                headers: response.headers,
                                async *bytes(): AsyncGenerator<Uint8Array, void, void> {
                                        const decoder = new TextDecoder();
                                        try {
                                                for await (const chunk of response.bytes()) {
                                                        draft.chunkCount++;
                                                        draft.text += decoder.decode(chunk, { stream: true });
                                                        yield chunk;
                                                }
                                                draft.text += decoder.decode();
                                        } finally {
                                                record();
                                        }
                                },
                        };
                },
        };
        return { port, observations };
}

// ---------------------------------------------------------------------------
// The shared row machinery (real adapter, real seam).
// ---------------------------------------------------------------------------

/** Everything a row needs, injected (the contract test drives these with stubs). */
export interface RowRunPorts {
        readonly baseUrl: string;
        readonly model: string;
        readonly secrets: SecretResolverPort;
        readonly http: HttpPort;
        readonly wait: (ms: number) => Promise<void>;
        readonly extraHeaders: Readonly<Record<string, string>>;
        readonly invalidHeaders: Readonly<Record<string, string>>;
}

export interface RowOutcome {
        readonly status: 'pass' | 'fail';
        readonly detail: unknown;
}

function drillSha256Hex(input: string): string {
        return createHash('sha256').update(input, 'utf-8').digest('hex');
}

function drillModelDescriptor(modelId: string): ModelDescriptor {
        return {
                modelId,
                modelName: `Flauz live drill model (${modelId})`,
                family: 'live-provider-drill',
                version: 'drill',
                contextWindowTokens: 128_000,
                maxOutputTokens: 4_096,
                inputModalities: ['text'],
                toolCalling: false,
        };
}

/** The adapter is built per row, over the row's own observing tee. */
function rowAdapter(ports: RowRunPorts, http: HttpPort, requestTimeoutMs: number | undefined): ProviderAdapter {
        return createOpenAiCompatAdapter({
                config: {
                        providerId: 'flauz-live-provider-drill',
                        vendor: 'flauz-openai-compat',
                        displayName: 'Flauz Live Provider Drill',
                        baseUrl: ports.baseUrl,
                        credentialRef: `env:${LIVE_PROVIDER_ENV.apiKey}`,
                        models: [drillModelDescriptor(ports.model)],
                        ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
                },
                http,
                secrets: ports.secrets,
                hash: { sha256Hex: drillSha256Hex },
                clock: () => Date.now(),
        });
}

/** The minimal verification request every row issues. */
function drillChatRequest(model: string): ChatRequest {
        return {
                modelId: model,
                messages: [{ role: 'user', content: [{ kind: 'text', value: 'flauz live-provider drill: reply with the single word "flauz" and nothing else' }] }],
        };
}

interface FinishFacts {
        readonly text: string;
        readonly finishReason: FinishReason;
        readonly usage: TokenUsage;
        readonly provenance: ResponseProvenance;
}

/** Runs one full streaming request; resolves with the finish facts, or throws (typed or not) as the seam produced it. */
async function streamOnce(adapter: ProviderAdapter, request: ChatRequest): Promise<FinishFacts> {
        let text = '';
        let finish: { finishReason: FinishReason; usage: TokenUsage; provenance: ResponseProvenance } | undefined;
        for await (const event of adapter.stream(request)) {
                if (event.type === 'text-delta') {
                        text += event.text;
                        continue;
                }
                if (event.type === 'finish') {
                        finish = { finishReason: event.finishReason, usage: event.usage, provenance: event.provenance };
                }
        }
        if (finish === undefined) {
                throw new Error('stream completed without a finish event');
        }
        return { text, finishReason: finish.finishReason, usage: finish.usage, provenance: finish.provenance };
}

/**
 * Model-echo law: the served model id must equal the requested one, with
 * exactly one dated-snapshot suffix `-YYYY-MM-DD` accepted (e.g. the dated
 * snapshots some vendors serve). Sibling ids (`-mini`, `.1`, `-5-sonnet`)
 * are a different model and do not pass.
 */
export function modelEchoMatches(echoed: string | undefined, configured: string): boolean {
        if (echoed === undefined || echoed.length === 0) {
                return false;
        }
        if (echoed === configured) {
                return true;
        }
        const prefix = `${configured}-`;
        if (!echoed.startsWith(prefix)) {
                return false;
        }
        return /^\d{4}-\d{2}-\d{2}$/.test(echoed.slice(prefix.length));
}

// ---------------------------------------------------------------------------
// Row: routing.
// ---------------------------------------------------------------------------

export async function runRoutingRow(ports: RowRunPorts): Promise<RowOutcome> {
        const tee = observingHttpPort(ports.http, ports.extraHeaders, {});
        const adapter = rowAdapter(ports, tee.port, undefined);
        try {
                const finish = await streamOnce(adapter, drillChatRequest(ports.model));
                const wire = tee.observations[0];
                const servedModel = wire?.wireModel;
                const modelEcho = modelEchoMatches(servedModel, ports.model);
                const httpStatus = wire?.status;
                const routed = finish.text.trim().length > 0 && modelEcho && httpStatus !== undefined && httpStatus >= 200 && httpStatus < 300;
                return {
                        status: routed ? 'pass' : 'fail',
                        detail: {
                                outcome: routed ? 'routed' : 'routing-check-failed',
                                httpStatus,
                                finishReason: finish.finishReason,
                                outputChars: finish.text.length,
                                servedModel,
                                requestedModel: ports.model,
                                modelEcho,
                        },
                };
        } catch (error) {
                return { status: 'fail', detail: { outcome: 'request-failed', error: errorFacts(error) } };
        }
}

// ---------------------------------------------------------------------------
// Row: auth-failure.
// ---------------------------------------------------------------------------

export async function runAuthFailureRow(ports: RowRunPorts): Promise<RowOutcome> {
        const tee = observingHttpPort(ports.http, ports.extraHeaders, ports.invalidHeaders);
        const adapter = rowAdapter(ports, tee.port, undefined);
        try {
                await streamOnce(adapter, drillChatRequest(ports.model));
                const wire = tee.observations[0];
                return {
                        status: 'fail',
                        detail: {
                                outcome: 'silent-success',
                                httpStatus: wire?.status ?? 200,
                                note: 'a deliberately-invalid credential produced a 2xx completion (no-silent-success law)',
                        },
                };
        } catch (error) {
                const wire = tee.observations[0];
                if (isProviderError(error)) {
                        const rejected = error.code === 'AUTH_FAILED' || error.code === 'PERMISSION_DENIED';
                        return {
                                status: rejected ? 'pass' : 'fail',
                                detail: {
                                        outcome: rejected ? 'auth-rejected' : 'unexpected-error-class',
                                        code: error.code,
                                        name: error.name,
                                        ...(error.status === undefined ? {} : { status: error.status }),
                                        httpStatus: wire?.status ?? error.status,
                                        invalidHeaderNames: Object.keys(ports.invalidHeaders),
                                },
                        };
                }
                return { status: 'fail', detail: { outcome: 'untyped-throw', error: errorFacts(error), httpStatus: wire?.status } };
        }
}

// ---------------------------------------------------------------------------
// Row: retry.
// ---------------------------------------------------------------------------

/**
 * The wall-clock-abort retry probe. Every attempt runs under a 1 ms budget
 * (requestTimeoutMs: 1 -> HttpPortAbortError('timeout') -> the typed TIMEOUT
 * class, retryable short-backoff). The window bound comes from the
 * environments lifecycle contract (resolveRetryBound; default 3). PASS
 * requires: the window exhausted at the bound with every attempt a typed
 * retryable class, attempts <= PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT, waits
 * applied through the policy (providerRetryWaitMs / the fixed delay).
 */
export async function runRetryRow(ports: RowRunPorts): Promise<RowOutcome> {
        const bound = resolveRetryBound(undefined);
        const tee = observingHttpPort(ports.http, ports.extraHeaders, {});
        const adapter = rowAdapter(ports, tee.port, 1);
        const attemptCodes: string[] = [];
        const waitsAppliedMs: number[] = [];
        try {
                for (let attempt = 1; attempt <= bound; attempt++) {
                        try {
                                await streamOnce(adapter, drillChatRequest(ports.model));
                                return {
                                        status: 'fail',
                                        detail: {
                                                outcome: 'success-under-abort-budget',
                                                note: 'a request with a 1 ms wall-clock budget completed; success under the abort budget is never accepted silently',
                                                attempts: attempt,
                                                attemptCodes,
                                                bound,
                                        },
                                };
                        } catch (error) {
                                if (!isProviderError(error)) {
                                        return { status: 'fail', detail: { outcome: 'untyped-throw', error: errorFacts(error), attempts: attempt, attemptCodes, bound } };
                                }
                                attemptCodes.push(error.code);
                                const status = error.status;
                                const engages = status !== undefined ? isRetryableProviderStatus(status) : error.retryable;
                                if (!engages) {
                                        return { status: 'fail', detail: { outcome: 'non-retryable-terminal', code: error.code, name: error.name, attempts: attempt, attemptCodes, bound } };
                                }
                                if (attempt < bound) {
                                        const hint = status === undefined ? undefined : { status, ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }) };
                                        const waitMs = hint === undefined ? PROVIDER_RETRY_FIXED_DELAY_MS : providerRetryWaitMs(hint);
                                        waitsAppliedMs.push(waitMs);
                                        await ports.wait(waitMs);
                                }
                        }
                }
                const exhaustedTyped = attemptCodes.length === bound && attemptCodes.length <= PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT;
                return {
                        status: exhaustedTyped ? 'pass' : 'fail',
                        detail: {
                                outcome: exhaustedTyped ? 'bounded-typed-exhaustion' : 'window-did-not-exhaust',
                                bound,
                                attempts: attemptCodes.length,
                                attemptCodes,
                                waitsAppliedMs,
                                wallClockAbortBudgetMs: 1,
                                boundedBy: 'resolveRetryBound(undefined) === PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT',
                        },
                };
        } catch (error) {
                return { status: 'fail', detail: { outcome: 'retry-row-threw', error: errorFacts(error), attemptCodes, bound } };
        }
}

// ---------------------------------------------------------------------------
// Row: provenance.
// ---------------------------------------------------------------------------

export async function runProvenanceRow(ports: RowRunPorts): Promise<RowOutcome> {
        const tee = observingHttpPort(ports.http, ports.extraHeaders, {});
        const adapter = rowAdapter(ports, tee.port, undefined);
        try {
                const finish = await streamOnce(adapter, drillChatRequest(ports.model));
                const wire = tee.observations[0];
                const servedModel = wire?.wireModel;
                const modelEcho = modelEchoMatches(servedModel, ports.model);
                const requestIdHeaders = wire?.responseHeaders ?? {};
                const checks = {
                        hasResponseId: wire?.responseId !== undefined && wire.responseId.length > 0,
                        hasRequestIdHeader: Object.keys(requestIdHeaders).length > 0,
                        modelEcho,
                        hasRequestHash: finish.provenance.requestHash.length > 0,
                        hasUsage: finish.usage.estimatedInputTokens >= 0 && finish.usage.estimatedOutputTokens >= 0,
                };
                const captured = (checks.hasResponseId || checks.hasRequestIdHeader) && checks.modelEcho && checks.hasRequestHash && checks.hasUsage;
                return {
                        status: captured ? 'pass' : 'fail',
                        detail: {
                                outcome: captured ? 'provenance-captured' : 'provenance-incomplete',
                                responseId: wire?.responseId,
                                requestIdHeaders,
                                servedModel,
                                requestedModel: ports.model,
                                modelEcho,
                                provenance: finish.provenance,
                                usage: finish.usage,
                                ...(wire?.wireUsage === undefined ? {} : { wireUsage: wire.wireUsage }),
                                httpStatus: wire?.status,
                                sseFrameCount: wire?.sseFrameCount,
                                checks,
                        },
                };
        } catch (error) {
                return { status: 'fail', detail: { outcome: 'request-failed', error: errorFacts(error) } };
        }
}

// ---------------------------------------------------------------------------
// The drill driver.
// ---------------------------------------------------------------------------

/** Everything runDrill needs, injected (the contract test injects stubs + a tripwire). */
export interface DrillPorts {
        readonly env: Record<string, string | undefined>;
        readonly http: HttpPort;
        readonly wait: (ms: number) => Promise<void>;
}

export interface DrillRunOutcome {
        readonly lines: readonly string[];
        readonly exitCode: number;
}

async function runRow(row: RowName, ports: RowRunPorts): Promise<RowOutcome> {
        if (row === 'routing') {
                return runRoutingRow(ports);
        }
        if (row === 'auth-failure') {
                return runAuthFailureRow(ports);
        }
        if (row === 'retry') {
                return runRetryRow(ports);
        }
        return runProvenanceRow(ports);
}

/**
 * The full drill: plan -> rows -> JSONL lines + exit code. Never throws, never
 * prints, never reads process.env (the caller's env view is the only input).
 */
export async function runDrill(ports: DrillPorts): Promise<DrillRunOutcome> {
        const env = readDrillEnv(ports.env);
        const plan = planRows(env);
        const headers = parseHeaderJson(env.headersJson);
        const invalid = parseHeaderJson(env.invalidHeadersJson);
        // Sweep-term collection law (the original delivery's documented design,
        // restored by the station 2026-09-29 after the LIVE z.ai-gateway run
        // caught the fidelity regression: terms shorter than 8 chars collide
        // with ordinary row content — a 1-char header value (X-Z-AI-From: "Z")
        // matches the UTC "Z" suffix of every startedAt timestamp, failing
        // every row fail-closed. Short values stay OUT of the term list; the
        // DETECTOR itself is unchanged (exact substring match).
        const secrets: string[] = [];
        if (env.apiKey !== undefined && env.apiKey.length >= 8) {
                secrets.push(env.apiKey);
        }
        for (const record of [headers.headers, invalid.headers]) {
                for (const value of Object.values(record)) {
                        if (value.length >= 8) {
                                secrets.push(value);
                        }
                }
        }
        const secretsResolver: SecretResolverPort = {
                async resolve(ref: string): Promise<string | undefined> {
                        return ref.startsWith('env:') ? ports.env[ref.slice('env:'.length)] : undefined;
                },
        };
        const lines: string[] = [];
        let failed = false;
        for (const entry of plan) {
                const startedAt = new Date().toISOString();
                const t0 = performance.now();
                let status: 'pass' | 'fail' | 'skip';
                let detail: unknown;
                if (entry.status === 'skip') {
                        status = 'skip';
                        detail = { reason: entry.reason };
                } else {
                        const rowPorts: RowRunPorts = {
                                baseUrl: env.baseUrl ?? '',
                                model: env.model ?? '',
                                secrets: secretsResolver,
                                http: ports.http,
                                wait: ports.wait,
                                extraHeaders: headers.headers,
                                invalidHeaders: invalid.headers,
                        };
                        let outcome: RowOutcome;
                        try {
                                outcome = await runRow(entry.row, rowPorts);
                        } catch (error) {
                                outcome = { status: 'fail', detail: { outcome: 'row-runner-threw', error: errorFacts(error) } };
                        }
                        status = outcome.status;
                        detail = outcome.detail;
                }
                const finalized = finalizeRow(entry.row, status, detail, startedAt, Math.max(0, Math.round(performance.now() - t0)), secrets);
                if (finalized.status === 'fail') {
                        failed = true;
                }
                lines.push(finalized.line);
        }
        return { lines, exitCode: failed ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// CLI entry (direct invocation only; the contract test imports this module
// without triggering it). stdout carries ONLY the JSONL rows.
// ---------------------------------------------------------------------------

const entry = (process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const invokedDirectly = entry.length > 1 && import.meta.url.endsWith(entry);

if (invokedDirectly) {
        void runDrill({ env: process.env, http: nodeHttpPort, wait: defaultRetryWait }).then(
                outcome => {
                        for (const line of outcome.lines) {
                                console.log(line);
                        }
                        process.exit(outcome.exitCode);
                },
                error => {
                        console.error(`live-provider drill: harness failure (${error instanceof Error ? error.name : 'unknown'})`);
                        process.exit(1);
                },
        );
}
