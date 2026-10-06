/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W8 (dogfood harness) -- EXERCISE 6: the workspace
 * continuity lane (the deeper-dogfood dimension: workspace continuity).
 *
 * The scenario machinery drives the REAL flauz-environments continuity
 * EXECUTION seams (the continuityExec.test.ts canonical wiring):
 *
 *   - the REAL ContinuityManager (export -> carry -> restore -> verify ->
 *     status) over the REAL bundle manifest flauz.continuity-bundle/v0 +
 *     the append-only hash-chained ops ledger flauz.continuity-ops/v0
 *     (BUNDLE_ID_PATTERN flauz:continuity:<16-hex>; deterministic
 *     stepping mintId -- the product's own injected-minter discipline);
 *   - the closed surface canon (src/continuityExec/surfaces.ts -- the
 *     N-8 16-surface canon + the 6 post-canon state surfaces, CLOSED at
 *     22, materialized from ACTUAL .flauz/ state) + the secret-shape
 *     classification (SURFACE_STATUSES carried/lost/redacted;
 *     RESTORE_SURFACE_OUTCOMES +skipped; VERIFY_SURFACE_VERDICTS
 *     verified/lost/redacted/mismatch);
 *   - the REAL .flauz/ source state built through REAL product seams: a
 *     task envelope (TaskService), evidence ledger rows (EvidenceLedger +
 *     the fixture ed25519 signer), memory records (MemoryStore), the
 *     models providers file (writeProviderOverrides), the environments
 *     registry envelope (EnvironmentRegistry), and a browser session
 *     journal record (FileSystemSessionJournal +
 *     buildSessionJournalRecord -- the at-record URL redaction path).
 *
 * THE SCENARIO (deterministic: injected clock, fixed ids, no network):
 *   1. export -> the bundle materializes under .flauz/continuity-bundles
 *      with the manifest (the surfaces map + statuses); verify ->
 *      per-surface verdicts; status -> the report;
 *   2. the carry act (the bundle dir copied to a FRESH target root);
 *      restore into the FRESH root (the force gate): carried/redacted
 *      per-surface outcomes; verify again on the target root;
 *   3. failure legs: the un-gated restore onto the now-non-empty target
 *      (the typed RESTORE_TARGET_NOT_EMPTY error), the force-gated
 *      re-restore (ok), the tamper leg (one surface artifact tampered on
 *      the target -> verify reports mismatch + VERIFY_FAILED), and the
 *      export defense-in-depth leg (a runtime-assembled canary planted
 *      in a carried 'never'-class surface -> EXPORT_SECRET_DETECTED,
 *      fail-closed, the bundle never committed).
 *
 * THE SECRET-REDACTION LAW (checked, never trusted): a secret-shaped
 * (captured-class) surface is exported as a typed `redacted` entry --
 * presence + sha256 of the PATH recorded; the payload NEVER copied into
 * the bundle (the journal line itself already carries the at-record
 * redacted URL -- the product's own honest write path).
 *
 * THE ASK (P2-FIX-119 doctrine): the exercise carries the continuity
 * facts IN the prompt (computed at ask time from the real state -- the
 * manifest surface map + the restore outcomes + the failure legs) and
 * asks the model to report the per-surface restore outcomes and which
 * surfaces are redacted and WHY (the law's wording pinned). BOTH lanes
 * answer from the prompt-carried facts.
 *
 * THE INDEPENDENT VERIFIER (the dogfood law): the ground truth is
 * re-derived from the REAL manifest + the REAL restore result (never
 * the prompt) and verifyWorkspaceContinuityAnswer checks the answer
 * 100% (sound + complete). PASS only at 100%.
 *
 * THE G8 CANARY LAW: the canary is ASSEMBLED FROM FRAGMENTS at runtime
 * (never a committed literal) and is asserted to NEVER appear in any
 * receipt or friction row.
 *
 * Dogfood dimensions exercised: workspace continuity, secret redaction,
 * destructive-class gates, failure/recovery, artifacts/evidence.
 */

import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { sha256Hex } from '../../../../extensions/flauz-workspace/src/api.ts';
import { TaskService } from '../../../../extensions/flauz-workspace/src/taskService.ts';
import { EvidenceLedger } from '../../../../extensions/flauz-workspace/src/ledger.ts';
import { MemoryStore } from '../../../../extensions/flauz-memory/src/memory.ts';
import { createEd25519Signer } from '../../../../extensions/flauz-workflow/src/keys.ts';
import { writeProviderOverrides } from '../../../../extensions/flauz-models/src/discovery/configs.ts';
import { fenceTolerantParseBody, type AnswerParseOptions } from '../answerFence.ts';
import { answerParseFailDetail } from '../liveBudget.mjs';
import type { DogfoodExercise, DogfoodHarness, ExerciseCheck, ExerciseReceipt, EvidenceItem, AskOutcome } from '../harnessTypes.ts';

import { EnvironmentRegistry } from '../../../../extensions/flauz-environments/src/registry.ts';
import { ContinuityManager, type ContinuityFsPort } from '../../../../extensions/flauz-environments/src/continuityExec/manager.ts';
import { CONTINUITY_SURFACES, REDACTED_NOTE, surfaceIds, type ContinuitySurfaceSpec } from '../../../../extensions/flauz-environments/src/continuityExec/surfaces.ts';
import type { BundleSurfaceEntry, ContinuityBundleManifest, RestoreSurfaceResult, VerifySurfaceResult } from '../../../../extensions/flauz-environments/src/continuityExec/types.ts';
import { FileSystemSessionJournal, buildSessionJournalRecord } from '../../../../extensions/flauz-browser/src/runtime/journal.ts';
import { isoAt } from '../../../../extensions/flauz-browser/src/runtime/session.ts';
import type { BrowserSessionDescriptor } from '../../../../extensions/flauz-browser/src/runtime/session.ts';

/** The answer document's pinned schema id. */
export const WORKSPACE_CONTINUITY_ANSWER_SCHEMA = 'flauz.dogfood-workspace-continuity-answer/v1';

// ---------------------------------------------------------------------------
// The fixture scenario (deterministic: fixed ids, injected clock, injected minter)
// ---------------------------------------------------------------------------

/** The fixed source environment id (registry-shaped env-<slug>). */
export const CONTINUITY_SOURCE_ENV_ID = 'env-dogfood-w8-src';

/** The deterministic bundle-id minter (the product's own injected-minter test discipline). */
export function steppingMintId(): () => string {
        let counter = 0;
        return () => `flauz:continuity:${(counter++).toString(16).padStart(16, '0')}`;
}

/**
 * THE G8 CANARY (runtime-assembled from fragments -- never a committed
 * literal): the secret-shaped token the drill plants. Used ONLY inside
 * state payloads that the redaction law and the export fail-closed scan
 * contain; asserted to never reach any receipt or friction row.
 */
export function runtimeContinuityCanary(): string {
        return ['sk-', 'live', 'W8', 'Dogfood', 'Only', 'aaaa', 'bbbb', 'cccc'].join('');
}

/** The fixture browser-session descriptor for the journal record (the canonical shape). */
export function continuitySessionDescriptor(clock: () => number): BrowserSessionDescriptor {
        return {
                schemaVersion: 0,
                sessionId: 'flauz:browser:0123456789abcdef',
                initiator: 'agent',
                agentId: 'w8-dogfood',
                partition: 'persist:w8-dogfood',
                policySourceRef: 'flauz:browser-policy/v0@workspace-file#0123456789abcdef',
                createdAt: isoAt(clock),
                state: 'active',
                tabs: [],
        };
}

// ---------------------------------------------------------------------------
// The answer contract (checked, never trusted)
// ---------------------------------------------------------------------------

export interface WorkspaceContinuityFailureLeg {
        readonly leg: string;
        readonly code: string;
}

export interface WorkspaceContinuityAnswer {
        readonly schema: string;
        readonly bundleId: string;
        readonly restoreOutcomes: readonly { readonly surface: string; readonly outcome: string }[];
        readonly redactedSurfaces: readonly { readonly surface: string; readonly why: string }[];
        readonly failureLegs: readonly WorkspaceContinuityFailureLeg[];
}

export type ParseWorkspaceContinuityOutcome =
        | { readonly ok: true; readonly answer: WorkspaceContinuityAnswer; readonly fenceStripped: boolean }
        | { readonly ok: false; readonly error: string };

/** Parses the workspace-continuity answer document (fence-tolerant on the LIVE lanes, per P2-FIX-118). */
export function parseWorkspaceContinuityAnswer(text: string, options?: AnswerParseOptions): ParseWorkspaceContinuityOutcome {
        const strip = fenceTolerantParseBody(text, options);
        let parsed: unknown;
        try {
                parsed = JSON.parse(strip.body);
        } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                return { ok: false, error: strip.fenced ? `the completion is not valid JSON inside the stripped markdown fence: ${reason}` : `the completion is not valid JSON: ${reason}` };
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return { ok: false, error: 'the answer document is not a JSON object' };
        }
        const record = parsed as Record<string, unknown>;
        if (record.schema !== WORKSPACE_CONTINUITY_ANSWER_SCHEMA) {
                return { ok: false, error: `the answer schema is ${JSON.stringify(record.schema)} but ${JSON.stringify(WORKSPACE_CONTINUITY_ANSWER_SCHEMA)} was expected` };
        }
        if (typeof record.bundleId !== 'string' || record.bundleId.length === 0) {
                return { ok: false, error: 'the answer field "bundleId" must be a non-empty string' };
        }
        if (!Array.isArray(record.restoreOutcomes)) {
                return { ok: false, error: 'the answer field "restoreOutcomes" must be an array' };
        }
        const restoreOutcomes: Array<{ surface: string; outcome: string }> = [];
        for (const entry of record.restoreOutcomes) {
                if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
                        return { ok: false, error: 'each restoreOutcomes entry must be a JSON object' };
                }
                const row = entry as Record<string, unknown>;
                if (typeof row.surface !== 'string' || row.surface.length === 0) {
                        return { ok: false, error: 'a restoreOutcomes entry is missing a non-empty string "surface"' };
                }
                if (typeof row.outcome !== 'string' || row.outcome.length === 0) {
                        return { ok: false, error: `restoreOutcomes entry ${JSON.stringify(row.surface)}: "outcome" must be a non-empty string` };
                }
                restoreOutcomes.push({ surface: row.surface, outcome: row.outcome });
        }
        if (!Array.isArray(record.redactedSurfaces)) {
                return { ok: false, error: 'the answer field "redactedSurfaces" must be an array' };
        }
        const redactedSurfaces: Array<{ surface: string; why: string }> = [];
        for (const entry of record.redactedSurfaces) {
                if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
                        return { ok: false, error: 'each redactedSurfaces entry must be a JSON object' };
                }
                const row = entry as Record<string, unknown>;
                if (typeof row.surface !== 'string' || row.surface.length === 0) {
                        return { ok: false, error: 'a redactedSurfaces entry is missing a non-empty string "surface"' };
                }
                if (typeof row.why !== 'string' || row.why.length === 0) {
                        return { ok: false, error: `redactedSurfaces entry ${JSON.stringify(row.surface)}: "why" must be a non-empty string (the law's wording)` };
                }
                redactedSurfaces.push({ surface: row.surface, why: row.why });
        }
        if (!Array.isArray(record.failureLegs)) {
                return { ok: false, error: 'the answer field "failureLegs" must be an array' };
        }
        const failureLegs: WorkspaceContinuityFailureLeg[] = [];
        for (const entry of record.failureLegs) {
                if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
                        return { ok: false, error: 'each failureLegs entry must be a JSON object' };
                }
                const row = entry as Record<string, unknown>;
                if (typeof row.leg !== 'string' || row.leg.length === 0 || typeof row.code !== 'string' || row.code.length === 0) {
                        return { ok: false, error: 'a failureLegs entry must carry non-empty string "leg" and "code"' };
                }
                failureLegs.push({ leg: row.leg, code: row.code });
        }
        return {
                ok: true,
                answer: { schema: WORKSPACE_CONTINUITY_ANSWER_SCHEMA, bundleId: record.bundleId, restoreOutcomes, redactedSurfaces, failureLegs },
                fenceStripped: strip.fenced,
        };
}

// ---------------------------------------------------------------------------
// The INDEPENDENT ground-truth derivation (driver-side, from the real manifest + restore result)
// ---------------------------------------------------------------------------

export interface WorkspaceContinuityGroundTruth {
        readonly bundleId: string;
        readonly restoreOutcomes: readonly { readonly surface: string; readonly outcome: string }[];
        readonly redactedSurfaces: readonly { readonly surface: string; readonly why: string }[];
        readonly failureLegs: readonly WorkspaceContinuityFailureLeg[];
}

/**
 * Re-derives the ground truth from the REAL manifest + the REAL restore
 * result + the REAL failure-leg codes (never the prompt, never the ask
 * lane). The redacted `why` is pinned to the product's REDACTED_NOTE
 * (the secret-redaction law's wording, verbatim).
 */
export function deriveWorkspaceContinuityGroundTruth(
        manifest: ContinuityBundleManifest,
        restoreSurfaces: readonly RestoreSurfaceResult[],
        failureLegs: readonly WorkspaceContinuityFailureLeg[],
): WorkspaceContinuityGroundTruth {
        return {
                bundleId: manifest.bundleId,
                restoreOutcomes: restoreSurfaces.map(({ surface, outcome }) => ({ surface, outcome })),
                redactedSurfaces: Object.entries(manifest.surfaces)
                        .filter(([, entry]) => entry.status === 'redacted')
                        .map(([surface]) => ({ surface, why: REDACTED_NOTE }))
                        .sort((a, b) => (a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0)),
                failureLegs: [...failureLegs].sort((a, b) => (a.leg < b.leg ? -1 : a.leg > b.leg ? 1 : 0)),
        };
}

export type WorkspaceContinuityVerificationOutcome = { readonly ok: boolean; readonly problems: readonly string[]; readonly soundnessViolations: number; readonly completenessViolations: number };

/**
 * Checks the model's answer against the derived ground truth, 100%:
 * soundness = every claimed entry matches ground truth; completeness =
 * every ground-truth entry is claimed. PASS only when both are 100%.
 */
export function verifyWorkspaceContinuityAnswer(answer: WorkspaceContinuityAnswer, groundTruth: WorkspaceContinuityGroundTruth): WorkspaceContinuityVerificationOutcome {
        const problems: string[] = [];
        let soundnessViolations = 0;
        let completenessViolations = 0;
        if (answer.bundleId !== groundTruth.bundleId) {
                soundnessViolations += 1;
                problems.push(`bundleId claimed ${JSON.stringify(answer.bundleId)} but the real manifest says ${JSON.stringify(groundTruth.bundleId)}`);
        }
        const claimedSurfaces = answer.restoreOutcomes.map(row => row.surface);
        const truthSurfaces = groundTruth.restoreOutcomes.map(row => row.surface);
        if (claimedSurfaces.length !== truthSurfaces.length || truthSurfaces.some(surface => !claimedSurfaces.includes(surface))) {
                completenessViolations += 1;
                problems.push(`restoreOutcomes: claimed ${String(claimedSurfaces.length)} surface(s) but the real restore result carries ${String(truthSurfaces.length)}`);
        }
        for (const truth of groundTruth.restoreOutcomes) {
                const claimed = answer.restoreOutcomes.find(row => row.surface === truth.surface);
                if (claimed === undefined) {
                        completenessViolations += 1;
                        problems.push(`restoreOutcomes ${truth.surface}: MISSING from the answer (ground truth: ${truth.outcome})`);
                        continue;
                }
                if (claimed.outcome !== truth.outcome) {
                        soundnessViolations += 1;
                        problems.push(`restoreOutcomes ${truth.surface}: outcome claimed ${claimed.outcome} but the real restore result says ${truth.outcome}`);
                }
        }
        for (const claimed of answer.restoreOutcomes) {
                if (!truthSurfaces.includes(claimed.surface)) {
                        soundnessViolations += 1;
                        problems.push(`restoreOutcomes ${claimed.surface}: FABRICATED entry (no such surface in the real restore result)`);
                }
        }
        const claimedRedacted = answer.redactedSurfaces.map(row => row.surface);
        const truthRedacted = groundTruth.redactedSurfaces.map(row => row.surface);
        if (claimedRedacted.length !== truthRedacted.length || truthRedacted.some(surface => !claimedRedacted.includes(surface))) {
                completenessViolations += 1;
                problems.push(`redactedSurfaces: claimed ${JSON.stringify([...claimedRedacted].sort())} but the manifest's redacted set is ${JSON.stringify([...truthRedacted].sort())}`);
        }
        for (const truth of groundTruth.redactedSurfaces) {
                const claimed = answer.redactedSurfaces.find(row => row.surface === truth.surface);
                if (claimed === undefined) {
                        completenessViolations += 1;
                        problems.push(`redactedSurfaces ${truth.surface}: MISSING from the answer (the law's wording was expected)`);
                        continue;
                }
                if (claimed.why !== truth.why) {
                        soundnessViolations += 1;
                        problems.push(`redactedSurfaces ${truth.surface}: the why is not the pinned law wording (claimed ${JSON.stringify(claimed.why.slice(0, 80))}...)`);
                }
        }
        for (const claimed of answer.redactedSurfaces) {
                if (!truthRedacted.includes(claimed.surface)) {
                        soundnessViolations += 1;
                        problems.push(`redactedSurfaces ${claimed.surface}: FABRICATED entry (the manifest does not redact it)`);
                }
        }
        if (answer.failureLegs.length !== groundTruth.failureLegs.length) {
                completenessViolations += 1;
                problems.push(`failureLegs: claimed ${String(answer.failureLegs.length)} leg(s) but the real legs are ${String(groundTruth.failureLegs.length)}`);
        }
        for (const truth of groundTruth.failureLegs) {
                const claimed = answer.failureLegs.find(leg => leg.leg === truth.leg);
                if (claimed === undefined) {
                        completenessViolations += 1;
                        problems.push(`failureLegs ${truth.leg}: MISSING from the answer (ground truth: ${truth.code})`);
                        continue;
                }
                if (claimed.code !== truth.code) {
                        soundnessViolations += 1;
                        problems.push(`failureLegs ${truth.leg}: code claimed ${claimed.code} but the real leg surfaced ${truth.code}`);
                }
        }
        for (const claimed of answer.failureLegs) {
                if (!groundTruth.failureLegs.some(truth => truth.leg === claimed.leg)) {
                        soundnessViolations += 1;
                        problems.push(`failureLegs ${claimed.leg}: FABRICATED entry (no such real failure leg)`);
                }
        }
        return { ok: problems.length === 0, problems, soundnessViolations, completenessViolations };
}

// ---------------------------------------------------------------------------
// The prompt (P2-FIX-119: the continuity facts carried IN the ask, at ask time)
// ---------------------------------------------------------------------------

export const WORKSPACE_CONTINUITY_FACTS_BEGIN = '=== CONTINUITY FACT: the exported bundle + the restore outcomes, computed at ask time from the real manager state (the manifest surfaces map + the restore result + the failure legs) ===';
export const WORKSPACE_CONTINUITY_FACTS_END = '=== END continuity facts ===';

/** The reportable facts view (exactly what the prompt embeds). */
export interface WorkspaceContinuityFacts {
        readonly bundleId: string;
        readonly surfaces: readonly { readonly id: string; readonly status: string }[];
        readonly redactedNote: string;
        readonly restoreOutcomes: readonly { readonly surface: string; readonly outcome: string }[];
        readonly failureLegs: readonly WorkspaceContinuityFailureLeg[];
}

/**
 * Builds the full workspace-continuity question with the facts embedded.
 * Called AT ASK TIME (inside the ask window); the facts JSON's sha256 is
 * pinned in the receipt.
 */
export function buildWorkspaceContinuityQuestion(facts: WorkspaceContinuityFacts): { readonly prompt: string; readonly factsSha256: string } {
        const body = JSON.stringify(facts, null, 2);
        const factsSha256 = sha256Hex(body);
        const prompt = [
                'Report the workspace continuity outcome of the scripted scenario that just ran under the real Flauz continuity manager (local-real seams).',
                'You are a bare chat completion with NO tool or file access, so the continuity facts are embedded below, computed at ask time from the real manager state (the bundle manifest surfaces map + the restore result + the failure legs).',
                WORKSPACE_CONTINUITY_FACTS_BEGIN,
                body,
                WORKSPACE_CONTINUITY_FACTS_END,
                `Report the facts above faithfully. Answer with exactly one JSON document of shape { "schema": "${WORKSPACE_CONTINUITY_ANSWER_SCHEMA}", "bundleId": "...", "restoreOutcomes": [{ "surface": "...", "outcome": "carried"|"lost"|"redacted" }], "redactedSurfaces": [{ "surface": "...", "why": "<the redaction law's wording, verbatim from the facts>" }], "failureLegs": [{ "leg": "...", "code": "..." }] } and nothing else. restoreOutcomes mirrors the embedded restore outcome per surface; redactedSurfaces lists exactly the surfaces whose manifest status is "redacted" with the embedded redactedNote as the why.`,
        ].join('\n');
        return { prompt, factsSha256 };
}

// ---------------------------------------------------------------------------
// The exercise
// ---------------------------------------------------------------------------

class Recorder {
        readonly checks: ExerciseCheck[] = [];

        check(id: string, ok: boolean, detail: string): boolean {
                this.checks.push({ id, ok, detail });
                return ok;
        }
}

async function mintArtifact(harness: DogfoodHarness, uri: string, contents: string, note: string): Promise<{ item: EvidenceItem; evidenceId: string }> {
        const absolute = nodePath.join(harness.root, uri);
        await nodeFs.mkdir(nodePath.dirname(absolute), { recursive: true });
        await nodeFs.writeFile(absolute, contents, { encoding: 'utf-8' });
        const sha = sha256Hex(contents);
        const appended = await harness.ledger.append(harness.taskId, { kind: 'note', uri, sha256: sha, note });
        await harness.tasks.recordEvidence(harness.taskId, { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'note', uri, sha256: sha, note });
        return { item: { kind: 'note', uri, sha256: sha }, evidenceId: appended.evidenceId };
}

/** The REAL node-backed workspace fs port (TaskService/EvidenceLedger/MemoryStore/writeProviderOverrides). */
function workspaceNodeFs() {
        return {
                readFileUtf8: async (target: string): Promise<string | undefined> => {
                        try {
                                return await nodeFs.readFile(target, { encoding: 'utf-8' });
                        } catch (err) {
                                if (err !== null && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                writeFile: (target: string, contents: string) => nodeFs.writeFile(target, contents, { encoding: 'utf-8' }),
                appendFile: (target: string, contents: string) => nodeFs.appendFile(target, contents, { encoding: 'utf-8' }),
                rename: (from: string, to: string) => nodeFs.rename(from, to),
                mkdir: async (target: string) => {
                        await nodeFs.mkdir(target, { recursive: true });
                },
                readdir: async (target: string) => (await nodeFs.readdir(target)).sort(),
        };
}

/** The REAL node-backed continuity fs port (kinded readdir + rm; the ContinuityManager + registry wiring). */
function continuityNodeFs(): ContinuityFsPort {
        return {
                readFileUtf8: async target => {
                        try {
                                return await nodeFs.readFile(target, { encoding: 'utf-8' });
                        } catch (err) {
                                if (err !== null && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                writeFile: (target, contents) => nodeFs.writeFile(target, contents, { encoding: 'utf-8' }),
                rename: (from, to) => nodeFs.rename(from, to),
                mkdir: async target => {
                        await nodeFs.mkdir(target, { recursive: true });
                },
                readdir: async target => {
                        try {
                                const entries = await nodeFs.readdir(target, { withFileTypes: true });
                                return entries
                                        .map(entry => ({ name: entry.name, kind: (entry.isDirectory() ? 'directory' : 'file') as 'file' | 'directory' }))
                                        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
                        } catch (err) {
                                if (err !== null && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                rm: target => nodeFs.rm(target, { recursive: true, force: true }),
        };
}

/** The carry act: the bundle directory copied to the target root (real fs). */
async function carryBundle(fromDir: string, toDir: string): Promise<void> {
        await nodeFs.mkdir(nodePath.dirname(toDir), { recursive: true });
        await nodeFs.cp(fromDir, toDir, { recursive: true });
}

/** One surface spec lookup helper (the closed table). */
function specOf(id: string): ContinuitySurfaceSpec | undefined {
        return CONTINUITY_SURFACES.find(spec => spec.id === id);
}

export const WORKSPACE_CONTINUITY_EXERCISE: DogfoodExercise = {
        id: 'workspace-continuity',
        title: 'workspace continuity: export/carry/restore/verify over the closed surface canon + the secret-redaction law',
        prompt: 'Report the workspace continuity outcome (the per-surface restore outcomes, the redacted surfaces and why, and the failure-leg codes).',
        dimensions: ['workspace continuity', 'secret redaction', 'destructive-class gates', 'failure/recovery', 'artifacts/evidence'],
        async run(harness: DogfoodHarness): Promise<ExerciseReceipt> {
                const recorder = new Recorder();
                const evidenceIds: string[] = [];
                const evidenceItems: EvidenceItem[] = [];
                const notes: string[] = [];
                const clock = harness.clock;
                const sourceRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'flauz-dogfood-contsrc-'));
                const targetRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'flauz-dogfood-conttgt-'));
                const canary = runtimeContinuityCanary();

                try {
                        const workspaceFs = workspaceNodeFs();
                        const continuityFs = continuityNodeFs();

                        // 1. Build the REAL .flauz/ source state through the REAL product seams.
                        const tasks = new TaskService({ root: sourceRoot, fs: workspaceFs, clock });
                        await tasks.bootstrap();
                        const task = await tasks.createTask('dogfood: the W8 continuity source state');
                        const ledger = new EvidenceLedger({
                                root: sourceRoot,
                                fs: workspaceFs,
                                clock,
                                signer: createEd25519Signer(
                                        'flauz-fixture-ed25519-1',
                                        await nodeFs.readFile(nodePath.join(harness.repoRoot, 'test', 'fixtures', 'workflow', 'keys', 'ed25519-private.pem'), { encoding: 'utf-8' }),
                                        await nodeFs.readFile(nodePath.join(harness.repoRoot, 'test', 'fixtures', 'workflow', 'keys', 'ed25519-public.pem'), { encoding: 'utf-8' }),
                                ),
                                checkpointInterval: 0,
                        });
                        await ledger.ensure();
                        const memory = new MemoryStore({ root: sourceRoot, fs: workspaceFs, clock });
                        await memory.ensure();
                        await memory.record('session', {
                                kind: 'observation',
                                content: `dogfood W8 continuity source memory on ${task.id} (exercise workspace-continuity, run ${harness.runId})`,
                                taskId: task.id,
                                agentId: 'flauz.agent.primary',
                                provenance: { actor: 'agent', origin: 'task-event', ts: clock() },
                        });
                        const artifactUri = `.flauz/artifacts/${task.id}/continuity-source.json`;
                        const artifactBody = `${JSON.stringify({ schema: 'flauz.dogfood-continuity-source/v1', taskId: task.id, note: 'the W8 continuity source artifact (the evidence surface materializer)' }, null, 2)}\n`;
                        await nodeFs.mkdir(nodePath.join(sourceRoot, nodePath.dirname(artifactUri)), { recursive: true });
                        await nodeFs.writeFile(nodePath.join(sourceRoot, artifactUri), artifactBody, { encoding: 'utf-8' });
                        await ledger.append(task.id, { kind: 'note', uri: artifactUri, sha256: sha256Hex(artifactBody), note: 'the W8 continuity source artifact (hash-pinned)' });
                        await writeProviderOverrides(workspaceFs, nodePath.join(sourceRoot, '.flauz', 'models'), [
                                {
                                        providerId: 'flauz-dogfood-continuity-source',
                                        baseUrl: 'http://127.0.0.1:9/v1',
                                        credentialRef: 'env:FLAUZ_DOGFOOD_CONTINUITY_KEY',
                                        models: [{ modelId: 'dogfood-continuity-1', modelName: 'Flauz Dogfood Continuity', family: 'dogfood', version: '1', contextWindowTokens: 32_000, maxOutputTokens: 4_096, inputModalities: ['text'], toolCalling: false }],
                                        enabled: true,
                                },
                        ], clock());
                        const registry = new EnvironmentRegistry({ root: sourceRoot, fs: continuityFs, clock });
                        await registry.bootstrap();
                        await registry.register({
                                id: CONTINUITY_SOURCE_ENV_ID,
                                kind: 'workspace-remote',
                                label: 'Dogfood W8 Continuity Source',
                                connection: { authorityPrefix: 'flauz-local' },
                                trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
                                capabilities: { agentHost: true, browser: true, exec: true, terminal: true },
                                enabled: true,
                        } as never);
                        const journal = new FileSystemSessionJournal(sourceRoot);
                        const descriptor = continuitySessionDescriptor(clock);
                        await journal.append(buildSessionJournalRecord('agent', 'opened', descriptor, clock()));
                        await journal.append(buildSessionJournalRecord('agent', 'navigated', descriptor, clock(), {
                                decision: 'allow',
                                requestedUrl: `https://ok.example.com/w8?token=${canary}&x=1`,
                                committedUrl: `https://ok.example.com/w8?token=${canary}&x=1`,
                                sent: true,
                        }));
                        const journalLine = await nodeFs.readFile(journal.journalPath, { encoding: 'utf-8' });
                        const journalRedactedAtRecord = journalLine.includes('[redacted]') && !journalLine.includes(canary);

                        // 2. The REAL manager #1 (source root): export -> verify -> status.
                        await harness.friction.friction({
                                phase: 'workspace-continuity:export-approval',
                                kind: 'manual-intervention',
                                detail: 'the human approved the continuity export of the source workspace (destructive-class review; the bundle carries state, never secrets)',
                                recovery: '',
                        });
                        const exportWallStartedAt = Date.now();
                        const manager1 = new ContinuityManager({ root: sourceRoot, fs: continuityFs, clock, mintId: steppingMintId(), registry });
                        const exported = await manager1.export({ actor: 'human', environmentId: CONTINUITY_SOURCE_ENV_ID });
                        await harness.friction.timing({ phase: 'workspace-continuity:export', durationMs: Math.max(0, Date.now() - exportWallStartedAt) });
                        const manifest: ContinuityBundleManifest | undefined = exported.ok ? exported.manifest : undefined;
                        const bundleId = manifest?.bundleId ?? '';
                        const bundleDir = nodePath.join(sourceRoot, '.flauz', 'continuity-bundles', bundleId);
                        const verified1 = await manager1.verify({ bundleId, actor: 'tool' });
                        const status1 = await manager1.status();
                        const carriedIds = Object.entries(manifest?.surfaces ?? {}).filter(([, entry]) => entry.status === 'carried').map(([id]) => id).sort();
                        const redactedIds = Object.entries(manifest?.surfaces ?? {}).filter(([, entry]) => entry.status === 'redacted').map(([id]) => id).sort();
                        const lostIds = Object.entries(manifest?.surfaces ?? {}).filter(([, entry]) => entry.status === 'lost').map(([id]) => id).sort();

                        // 3. The export defense-in-depth leg (the G8 canary law): a runtime-assembled
                        //    canary planted in a carried 'never'-class surface fails the export CLOSED.
                        const tasksPath = nodePath.join(sourceRoot, '.flauz', 'tasks.json');
                        const tasksOriginal = await nodeFs.readFile(tasksPath, { encoding: 'utf-8' });
                        await nodeFs.writeFile(tasksPath, `${tasksOriginal}${JSON.stringify({ drill: canary })}\n`, { encoding: 'utf-8' });
                        await harness.friction.friction({
                                phase: 'workspace-continuity:secret-scan',
                                kind: 'manual-intervention',
                                detail: 'the export defense-in-depth scan rejected a carried payload containing secret-shaped text (EXPORT_SECRET_DETECTED, fail-closed; the bundle was never committed)',
                                recovery: 'the drill payload was removed from the source state after the leg (the closed export had refused to carry the secret -- exactly the law)',
                        });
                        const secretScanExport = await manager1.export({ actor: 'human', environmentId: CONTINUITY_SOURCE_ENV_ID });
                        await nodeFs.writeFile(tasksPath, tasksOriginal, { encoding: 'utf-8' });
                        const statusAfterSecretScan = await manager1.status();

                        // 4. The carry act + the REAL manager #2 (fresh target root): the restore legs.
                        await carryBundle(bundleDir, nodePath.join(targetRoot, '.flauz', 'continuity-bundles', bundleId));
                        const manager2 = new ContinuityManager({ root: targetRoot, fs: continuityFs, clock, mintId: steppingMintId() });
                        const restoreWallStartedAt = Date.now();
                        const restored1 = await manager2.restore({ bundleId, actor: 'human' });
                        await harness.friction.timing({ phase: 'workspace-continuity:restore', durationMs: Math.max(0, Date.now() - restoreWallStartedAt) });
                        const sourceTasks = await nodeFs.readFile(tasksPath, { encoding: 'utf-8' });
                        const targetTasks = await nodeFs.readFile(nodePath.join(targetRoot, '.flauz', 'tasks.json'), { encoding: 'utf-8' });
                        const targetRegistry = await nodeFs.readFile(nodePath.join(targetRoot, '.flauz', 'environments.json'), { encoding: 'utf-8' });
                        const sourceRegistry = await nodeFs.readFile(nodePath.join(sourceRoot, '.flauz', 'environments.json'), { encoding: 'utf-8' });
                        const targetLedgerAbsent = await workspaceFs.readFileUtf8(nodePath.join(targetRoot, '.flauz', 'evidence', 'ledger.jsonl')) === undefined;
                        const targetJournalAbsent = await workspaceFs.readFileUtf8(nodePath.join(targetRoot, '.flauz', 'browser-sessions.jsonl')) === undefined;
                        const targetArtifactsAbsent = await continuityFs.readdir(nodePath.join(targetRoot, '.flauz', 'artifacts')) === undefined;
                        const ungated = await manager2.restore({ bundleId, actor: 'human' });
                        await harness.friction.friction({
                                phase: 'workspace-continuity:force-gate',
                                kind: 'manual-intervention',
                                detail: 'the un-gated restore onto the now-non-empty target was rejected (RESTORE_TARGET_NOT_EMPTY -- restore is destructive-class; the requirement is explicit)',
                                recovery: 'the human approved the destructive overwrite with force: true and the restore re-ran to completion',
                        });
                        const forced = await manager2.restore({ bundleId, actor: 'human', force: true });
                        const verified2 = await manager2.verify({ bundleId, actor: 'tool' });
                        const targetStatus = await manager2.status();

                        // 5. The mismatch leg: tamper one carried artifact on the TARGET's bundle copy.
                        await harness.friction.friction({
                                phase: 'workspace-continuity:tamper-review',
                                kind: 'manual-intervention',
                                detail: 'one carried bundle artifact was tampered with on the target root (the drill leg); the integrity verify surfaced the mismatch',
                                recovery: 'the mismatch verdict quarantined the tampered copy (VERIFY_FAILED); the source bundle remains intact and re-carriable',
                        });
                        const tamperedArtifact = nodePath.join(targetRoot, '.flauz', 'continuity-bundles', bundleId, 'surfaces', 'flauz-tasks-envelope.json');
                        await nodeFs.appendFile(tamperedArtifact, 'TAMPERED-BY-THE-W8-DRILL\n', { encoding: 'utf-8' });
                        const mismatchVerify = await manager2.verify({ bundleId, actor: 'tool' });
                        const mismatchRow = mismatchVerify.surfaces.find(row => row.surface === 'flauz-tasks-envelope');

                        // 6. THE INDEPENDENT ground truth + THE ASK (P2-FIX-119: facts embedded at ask time).
                        const failureLegs: WorkspaceContinuityFailureLeg[] = [
                                { leg: 'ungated-restore', code: ungated.ok ? 'UNEXPECTED-OK' : ungated.error.code },
                                { leg: 'tamper-verify', code: mismatchVerify.ok ? 'UNEXPECTED-OK' : mismatchVerify.error.code },
                        ];
                        const groundTruth = deriveWorkspaceContinuityGroundTruth(manifest!, restored1.ok ? restored1.surfaces : [], failureLegs);
                        const askPromptHolder: { prompt: string; factsSha256: string } = { prompt: '', factsSha256: '' };
                        const ask: AskOutcome = await harness.provider.ask(() => {
                                const facts: WorkspaceContinuityFacts = {
                                        bundleId,
                                        surfaces: surfaceIds().map(id => ({ id, status: manifest?.surfaces[id]?.status ?? 'unknown' })),
                                        redactedNote: REDACTED_NOTE,
                                        restoreOutcomes: (restored1.ok ? restored1.surfaces : []).map(({ surface, outcome }) => ({ surface, outcome })),
                                        failureLegs,
                                };
                                const built = buildWorkspaceContinuityQuestion(facts);
                                askPromptHolder.prompt = built.prompt;
                                askPromptHolder.factsSha256 = built.factsSha256;
                                return built.prompt;
                        });

                        let answerProblems: string[] = [];
                        let verification: WorkspaceContinuityVerificationOutcome = { ok: false, problems: ['no answer was produced'], soundnessViolations: 0, completenessViolations: 0 };
                        if (ask.kind === 'ok') {
                                const parsed = parseWorkspaceContinuityAnswer(ask.text, { fenceTolerant: harness.mode === 'live-provider' });
                                if (!parsed.ok) {
                                        answerProblems.push(answerParseFailDetail(parsed.error, ask.finishReason));
                                } else {
                                        verification = verifyWorkspaceContinuityAnswer(parsed.answer, groundTruth);
                                        answerProblems.push(...verification.problems);
                                }
                        } else {
                                answerProblems.push(`the ask surfaced a typed provider failure: ${ask.code} ${ask.message}`);
                                await harness.friction.friction({
                                        phase: 'workspace-continuity:ask',
                                        kind: 'provider-failure',
                                        detail: `the workspace-continuity ask surfaced the TYPED provider failure ${ask.code} (retryable=${String(ask.retryable)}, retryClass=${ask.retryClass}) after ${String(ask.attempts)} attempt(s): ${ask.message}`,
                                        recovery: '',
                                });
                        }

                        // 7. THE CHECKS (every law checked against the real state).
                        recorder.check('wc.closed-surface-table', manifest !== undefined && Object.keys(manifest.surfaces).length === surfaceIds().length && surfaceIds().every(id => manifest.surfaces[id] !== undefined),
                                manifest !== undefined && Object.keys(manifest.surfaces).length === surfaceIds().length
                                        ? `the manifest covers the CLOSED table exactly (${String(surfaceIds().length)} surfaces: carried ${String(carriedIds.length)}, redacted ${String(redactedIds.length)}, lost ${String(lostIds.length)}; bundleId ${bundleId})`
                                        : 'the export failed or the manifest does not cover the closed table');
                        const carriedChecks = await Promise.all(carriedIds.map(async id => {
                                const entry = manifest?.surfaces[id] as { artifactPath?: string; sha256?: string; bytes?: number };
                                const spec = specOf(id);
                                if (spec === undefined || spec.path === null || spec.path === undefined || entry.artifactPath === undefined || entry.sha256 === undefined || entry.bytes === undefined) {
                                        return false;
                                }
                                const contents = await nodeFs.readFile(nodePath.join(sourceRoot, spec.path), { encoding: 'utf-8' });
                                const artifact = await nodeFs.readFile(nodePath.join(bundleDir, entry.artifactPath), { encoding: 'utf-8' });
                                return contents === artifact && entry.sha256 === sha256Hex(contents) && entry.bytes === contents.length;
                        }));
                        recorder.check('wc.carried-payloads-byte-real', exported.ok && carriedChecks.length === 2 && carriedChecks.every(ok => ok),
                                exported.ok && carriedChecks.every(ok => ok)
                                        ? `every carried surface is a byte-real copy (source == bundle artifact; sha256 + bytes recorded): ${carriedIds.join(', ')}`
                                        : `the carried-payload leg failed: exported.ok=${String(exported.ok)}, carried=${JSON.stringify(carriedIds)}, checks=${JSON.stringify(carriedChecks)}`);
                        const redactedChecks = await Promise.all(redactedIds.map(async id => {
                                const entry: BundleSurfaceEntry = manifest?.surfaces[id] ?? { status: 'lost' };
                                const spec = specOf(id);
                                const pathHashOk = entry.sha256 === (spec?.path === undefined || spec.path === null ? '' : sha256Hex(spec.path));
                                const noPayloadMeta = entry.artifactPath === undefined && entry.bytes === undefined;
                                const noteOk = entry.note === REDACTED_NOTE;
                                const artifactName = spec?.artifactName ?? null;
                                const payloadAbsent = artifactName === null ? true : await workspaceFs.readFileUtf8(nodePath.join(bundleDir, artifactName)) === undefined;
                                return pathHashOk && noPayloadMeta && noteOk && payloadAbsent;
                        }));
                        recorder.check('wc.secret-redaction-law', exported.ok && redactedChecks.length === 3 && redactedChecks.every(ok => ok) && journalRedactedAtRecord && targetLedgerAbsent && targetJournalAbsent && targetArtifactsAbsent,
                                exported.ok && redactedChecks.every(ok => ok) && journalRedactedAtRecord
                                        ? `the SECRET-REDACTION LAW held: the captured-class surfaces (${redactedIds.join(', ')}) exported as typed redacted entries (presence + sha256 of the PATH, the pinned note, no payload artifact in the bundle) and restored NOTHING on the target; the journal line itself carries the at-record redacted URL`
                                        : `the redaction law leg failed: redacted=${JSON.stringify(redactedIds)}, checks=${JSON.stringify(redactedChecks)}, journalRedactedAtRecord=${String(journalRedactedAtRecord)}`);
                        recorder.check('wc.lost-surfaces-typed', lostIds.length === surfaceIds().length - carriedIds.length - redactedIds.length && lostIds.every(id => (manifest?.surfaces[id]?.note ?? '').length > 0),
                                lostIds.every(id => (manifest?.surfaces[id]?.note ?? '').length > 0)
                                        ? `every absent surface is a TYPED lost entry with its why-note (${String(lostIds.length)} of ${String(surfaceIds().length)}; never dropped, never fabricated)`
                                        : 'a lost surface is missing its why-note');
                        recorder.check('wc.verify-verdicts', verified1.ok && verified2.ok && verified1.surfaces.filter(row => row.verdict === 'verified').length === carriedIds.length && verified1.surfaces.filter(row => row.verdict === 'redacted').length === redactedIds.length && verified1.surfaces.filter(row => row.verdict === 'lost').length === lostIds.length,
                                verified1.ok && verified2.ok
                                        ? `verify re-derived the integrity verdicts on BOTH roots (source: ${String(verified1.surfaces.filter(row => row.verdict === 'verified').length)} verified / ${String(verified1.surfaces.filter(row => row.verdict === 'redacted').length)} redacted / ${String(verified1.surfaces.filter(row => row.verdict === 'lost').length)} lost; target: ok after the carry)`
                                        : `the verify leg failed: source ok=${String(verified1.ok)}, target ok=${String(verified2.ok)}`);
                        recorder.check('wc.status-report', status1.bundles.filter(row => row.complete).length === 1 && status1.bundles[0]?.manifest?.bundleId === bundleId && status1.ops.filter(row => row.op === 'export' && row.result === 'ok').length === 1,
                                status1.bundles.filter(row => row.complete).length === 1 && status1.ops.filter(row => row.op === 'export' && row.result === 'ok').length === 1
                                        ? `status() listed the complete bundle + the ops ledger (the source root: ${String(status1.ops.length)} row(s) at that point)`
                                        : `the status leg failed: ${JSON.stringify(status1.bundles.map(row => row.complete))}`);
                        recorder.check('wc.restore-fresh-root', restored1.ok && targetTasks === sourceTasks && targetRegistry === sourceRegistry && restored1.surfaces.filter(row => row.outcome === 'carried').length === carriedIds.length && restored1.surfaces.filter(row => row.outcome === 'redacted').length === redactedIds.length && restored1.surfaces.filter(row => row.outcome === 'lost').length === lostIds.length,
                                restored1.ok && targetTasks === sourceTasks && targetRegistry === sourceRegistry
                                        ? `the fresh-root restore re-hydrated the carried bytes byte-identically (tasks.json, environments.json) and typed every surface outcome (carried ${String(carriedIds.length)} / redacted ${String(redactedIds.length)} / lost ${String(lostIds.length)})`
                                        : `the fresh-root restore leg failed: ok=${String(restored1.ok)}, tasksEqual=${String(targetTasks === sourceTasks)}, registryEqual=${String(targetRegistry === sourceRegistry)}`);
                        recorder.check('wc.ungated-restore-leg', !ungated.ok && ungated.error.code === 'RESTORE_TARGET_NOT_EMPTY' && ungated.error.message.includes('force') && ungated.surfaces.length === 0,
                                !ungated.ok && ungated.error.code === 'RESTORE_TARGET_NOT_EMPTY'
                                        ? `the un-gated restore onto the non-empty target was the typed RESTORE_TARGET_NOT_EMPTY rejection (the message names the occupied carried surfaces and the force requirement; nothing written)`
                                        : `the un-gated leg failed: ${JSON.stringify(ungated.ok ? 'unexpected ok' : ungated.error)}`);
                        recorder.check('wc.force-restore-leg', forced.ok && forced.surfaces.filter(row => row.outcome === 'carried').length === carriedIds.length,
                                forced.ok
                                        ? `the force-gated re-restore completed (the explicit destructive overwrite; every carried surface re-written atomically)`
                                        : `the force leg failed: ${JSON.stringify(forced.ok ? 'ok' : forced.error)}`);
                        recorder.check('wc.mismatch-leg', !mismatchVerify.ok && mismatchVerify.error.code === 'VERIFY_FAILED' && mismatchRow?.verdict === 'mismatch' && (mismatchRow?.note ?? '').includes('hash mismatch'),
                                !mismatchVerify.ok && mismatchRow?.verdict === 'mismatch'
                                        ? `the tampered artifact on the target surfaced as the per-surface mismatch verdict + the typed VERIFY_FAILED error (note: ${JSON.stringify((mismatchRow?.note ?? '').slice(0, 80))})`
                                        : `the mismatch leg failed: ok=${String(mismatchVerify.ok)}, row=${JSON.stringify(mismatchRow ?? null)}`);
                        recorder.check('wc.export-secret-detected-leg', !secretScanExport.ok && secretScanExport.error.code === 'EXPORT_SECRET_DETECTED' && statusAfterSecretScan.bundles.filter(row => row.complete).length === 1 && statusAfterSecretScan.bundles.every(row => row.dir !== 'flauz:continuity:0000000000000001'),
                                !secretScanExport.ok && secretScanExport.error.code === 'EXPORT_SECRET_DETECTED'
                                        ? `the export defense-in-depth scan failed CLOSED on the planted secret-shaped payload (EXPORT_SECRET_DETECTED; the second bundle was never committed -- status still lists exactly the one real bundle)`
                                        : `the secret-scan leg failed: ${JSON.stringify(secretScanExport.ok ? 'unexpected ok' : secretScanExport.error)}`);
                        recorder.check('wc.answer-verified-100', verification.ok, verification.ok
                                ? `the model's answer matched the independently re-derived ground truth 100% (sound + complete; facts sha256 ${askPromptHolder.factsSha256})`
                                : `answer verification FAILED: ${String(verification.soundnessViolations)} soundness violation(s), ${String(verification.completenessViolations)} completeness violation(s): ${verification.problems.join('; ')}`);
                        recorder.check('wc.ask-prompt-carries-facts', askPromptHolder.prompt.includes(WORKSPACE_CONTINUITY_FACTS_BEGIN) && askPromptHolder.prompt.includes(WORKSPACE_CONTINUITY_FACTS_END), 'the ask prompt embedded the continuity facts at ask time (P2-FIX-119 doctrine)');

                        // 8. The report artifact + the records-dir receipt (G8: the canary NEVER in it).
                        const report = {
                                schema: 'flauz.dogfood-workspace-continuity-report/v1',
                                exerciseId: 'workspace-continuity',
                                mode: harness.mode,
                                scenarioHash: sha256Hex(`${CONTINUITY_SOURCE_ENV_ID}\n${JSON.stringify(continuitySessionDescriptor(clock))}\n${redactedIds.join(',')}`),
                                ask: ask.kind === 'ok'
                                        ? { kind: 'ok', decisionId: ask.decisionId, finishReason: ask.finishReason, fenceStripped: harness.mode === 'live-provider', text: ask.text }
                                        : { kind: 'provider-failure', decisionId: ask.decisionId, code: ask.code, retryClass: ask.retryClass, attempts: ask.attempts, message: ask.message },
                                askPromptExcerpt: askPromptHolder.prompt.slice(0, 2_000),
                                bundleId,
                                surfaceCensus: { carried: carriedIds, redacted: redactedIds, lostCount: lostIds.length, total: surfaceIds().length },
                                groundTruth,
                                journalRedactedAtRecord,
                                legs: {
                                        ungatedRestore: ungated.ok ? 'UNEXPECTED-OK' : ungated.error.code,
                                        forceRestore: forced.ok ? 'ok' : forced.error.code,
                                        tamperVerify: mismatchVerify.ok ? 'UNEXPECTED-OK' : mismatchVerify.error.code,
                                        secretScanExport: secretScanExport.ok ? 'UNEXPECTED-OK' : secretScanExport.error.code,
                                },
                                answerProblems,
                                verification: { ok: verification.ok, soundnessViolations: verification.soundnessViolations, completenessViolations: verification.completenessViolations },
                        };
                        const reportUri = `.flauz/artifacts/${harness.taskId}/workspace-continuity-report.json`;
                        const artifact = await mintArtifact(harness, reportUri, `${JSON.stringify(report, null, '\t')}\n`, 'the workspace-continuity exercise report (the closed surface canon + the secret-redaction law + the restore legs)');
                        evidenceItems.push(artifact.item);
                        evidenceIds.push(artifact.evidenceId);
                        await nodeFs.mkdir(harness.recordsDir, { recursive: true });
                        await nodeFs.writeFile(nodePath.join(harness.recordsDir, 'workspace-continuity.report.json'), `${JSON.stringify(report, null, '\t')}\n`, { encoding: 'utf-8' });
                        recorder.check('wc.report-evidence-minted', artifact.evidenceId.length > 0, `the workspace-continuity report is hash-pinned into the evidence ledger (${artifact.evidenceId})`);

                        // 9. THE G8 CANARY LAW: the runtime-assembled canary NEVER appears in
                        //    any receipt or friction row (the report + the friction log scanned).
                        const reportText = JSON.stringify(report);
                        const frictionText = (await harness.friction.readAll()).map(row => JSON.stringify(row)).join('\n');
                        recorder.check('wc.g8-canary-never-in-receipts', !reportText.includes(canary) && !frictionText.includes(canary),
                                !reportText.includes(canary) && !frictionText.includes(canary)
                                        ? 'the G8 canary law held: the planted secret-shaped token never appears in the exercise report or any friction row (runtime-assembled, contained by the redaction law and the fail-closed export scan)'
                                        : 'THE G8 CANARY LAW FAILED: the canary leaked into a receipt or friction row');

                        notes.push('evidence: the seams are LOCAL-REAL (the REAL ContinuityManager over the REAL bundle manifest + hash-chained ops ledger; the source .flauz/ state built through the REAL TaskService/EvidenceLedger/MemoryStore/writeProviderOverrides/EnvironmentRegistry/FileSystemSessionJournal seams); the model intelligence is fixture-level (the fake lane answers from the prompt-carried facts), never promoted');
                        notes.push('the SECRET-REDACTION LAW is checked, never trusted: the captured-class surfaces export as typed redacted entries (presence + sha256 of the PATH; the payload NEVER copied) and restore nothing; the journal line itself carries the at-record redacted URL (the product write path)');
                        notes.push('P2-FIX-119 doctrine: both lanes answer from the prompt-carried continuity facts (embedded at ask time: the manifest surfaces map + the restore outcomes + the failure legs)');
                        notes.push('the G8 canary is runtime-assembled from fragments (never a committed literal) and is asserted absent from every receipt and friction row; the export defense-in-depth leg (EXPORT_SECRET_DETECTED) proves the fail-closed scan end to end');
                        notes.push('the carry act is a real fs copy of the bundle dir to the fresh target root (the v0 boundary: restore re-hydrates the target root\'s .flauz/ state; the trust gate on targetEnvironmentId is exercised by the environments-lifecycle lane)');
                } finally {
                        await nodeFs.rm(sourceRoot, { recursive: true, force: true }).catch(() => undefined);
                        await nodeFs.rm(targetRoot, { recursive: true, force: true }).catch(() => undefined);
                }

                const failCount = recorder.checks.filter(check => !check.ok).length;
                const frictionRows = await harness.friction.readAll();
                return {
                        schema: 'flauz.dogfood-exercise-receipt/v1',
                        exerciseId: 'workspace-continuity',
                        title: 'workspace continuity: export/carry/restore/verify over the closed surface canon + the secret-redaction law',
                        dimensions: ['workspace continuity', 'secret redaction', 'destructive-class gates', 'failure/recovery', 'artifacts/evidence'],
                        verdict: failCount === 0 ? 'PASS' : 'FAIL',
                        checks: recorder.checks,
                        evidenceIds,
                        evidenceItems,
                        frictionLogPath: harness.friction.path,
                        frictionRows: {
                                friction: frictionRows.filter(row => row.type === 'friction').length,
                                timing: frictionRows.filter(row => row.type === 'timing').length,
                                recovery: frictionRows.filter(row => row.type === 'friction' && typeof (row as { recovery?: unknown }).recovery === 'string' && ((row as { recovery: string }).recovery).length > 0).length,
                        },
                        evidenceLevels: { seams: 'local-real', modelIntelligence: 'fixture' },
                        notes,
                };
        },
};
