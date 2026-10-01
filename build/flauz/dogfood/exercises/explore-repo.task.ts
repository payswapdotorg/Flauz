/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W1 (dogfood harness) -- EXERCISE 1: repository exploration.
 *
 * A REAL exploration question over the REAL clone, driven through the
 * agent seams (task envelope -> session claim -> Model Fabric route ->
 * adapter stream) with the model's answer CHECKED against the tree,
 * never trusted:
 *
 *   "map every consumer of the evidence ledger across
 *    extensions/flauz-*: file + line + what it consumes"
 *
 * The fake-provider lane answers by scanning the real tree at request
 * time (its own implementation, fake-provider.mjs). THIS module holds
 * the driver-side INDEPENDENT implementation:
 *
 *   - scanLedgerConsumers(): the ground-truth scan (regex-based import
 *     extraction + specifier resolution -- a different algorithm from
 *     the provider's string-ops scanner, the same shared contract
 *     rules);
 *   - verifyConsumersMap(): the verifier -- every claimed entry is
 *     re-checked directly against the tree (file exists under
 *     extensions/flauz-*, the claimed line REALLY imports the ledger
 *     module, the claimed symbols match the line's bindings) and the
 *     map is checked for completeness against the ground truth. The
 *     exercise PASSES only at 100% verified (sound AND complete).
 *
 * Both scanners are pure functions over a root (fixture-testable);
 * the driver runs them against the real clone. The dogfood dimensions
 * exercised: repository exploration, artifacts/evidence, slow-path
 * timing rows.
 */

import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import { sha256Hex } from '../../../../extensions/flauz-workspace/src/api.ts';
import { fenceTolerantParseBody, type AnswerParseOptions } from '../answerFence.ts';
import { answerParseFailDetail, finishReasonDetail } from '../liveBudget.mjs';
import type { DogfoodExercise, DogfoodHarness, ExerciseCheck, ExerciseReceipt, EvidenceItem } from '../harnessTypes.ts';

/** The canonical evidence-ledger module (repo-relative, posix). */
export const LEDGER_MODULE = 'extensions/flauz-workspace/src/ledger.ts';

/** The answer document's pinned schema id. */
export const EXPLORE_ANSWER_SCHEMA = 'flauz.dogfood-explore-answer/v1';

/** Source extensions the contract considers (shared rule with the provider-side scanner). */
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

/**
 * THE QUESTION (verbatim task, operational definition pinned so the
 * model and the verifier agree on exactly what is being asked).
 */
export const EXPLORE_QUESTION = [
        'Map every consumer of the evidence ledger across extensions/flauz-*: file + line + what it consumes.',
        'Operational definition (the verifier enforces exactly this): a consumer is a file under extensions/flauz-*/ (any depth) carrying an import or export-from statement on a single line whose relative module specifier (./ or ../, resolved with extensionless->.ts and .js/.mjs/.cjs->.ts twinning) names extensions/flauz-workspace/src/ledger.ts.',
        'Report each consumer as { "file": repo-relative posix path, "line": the 1-based import line, "consumes": the imported named bindings (drop "type" markers) }.',
        `Answer with exactly one JSON document of shape { "schema": "${EXPLORE_ANSWER_SCHEMA}", "consumers": [ ... ] } and nothing else.`,
].join(' ');

// ---------------------------------------------------------------------------
// The driver-side ground-truth scanner (regex-based; independent of the
// provider-side string-ops scanner in fake-provider.mjs)
// ---------------------------------------------------------------------------

/** One import/export-from statement binding a module specifier. */
interface ImportStatement {
        readonly specifier: string;
        readonly symbols: readonly string[];
}

const NAMED_IMPORT = /^\s*(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/;
const NAMESPACE_IMPORT = /^\s*import\s+\*\s+as\s+[$_\w]+\s+from\s*['"]([^'"]+)['"]/;
const DEFAULT_IMPORT = /^\s*import\s+(?:type\s+)?[$_a-zA-Z][$_\w]*\s+from\s*['"]([^'"]+)['"]/;

/** Extracts the import statement of one line (null when the line imports nothing). */
export function parseImportStatement(line: string): ImportStatement | null {
        const named = NAMED_IMPORT.exec(line);
        if (named !== null) {
                const symbols = named[1] === undefined ? [] : named[1].split(',')
                        .map(part => part.trim().replace(/^type\s+/, '').trim())
                        .filter(part => part.length > 0);
                return { specifier: named[2] ?? '', symbols };
        }
        const namespace = NAMESPACE_IMPORT.exec(line);
        if (namespace !== null) {
                return { specifier: namespace[1] ?? '', symbols: ['*'] };
        }
        const defaults = DEFAULT_IMPORT.exec(line);
        if (defaults !== null) {
                return { specifier: defaults[1] ?? '', symbols: ['default'] };
        }
        return null;
}

/** Resolves a relative specifier against the importing file (posix; the shared contract rules). */
export function specifierResolvesTo(fromFilePosix: string, specifier: string, ledgerPosix: string): boolean {
        if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
                return false;
        }
        const dir = fromFilePosix.includes('/') ? fromFilePosix.slice(0, fromFilePosix.lastIndexOf('/')) : '';
        const segments = `${dir === '' ? '' : `${dir}/`}${specifier}`.split('/');
        const stack: string[] = [];
        for (const segment of segments) {
                if (segment === '' || segment === '.') {
                        continue;
                }
                if (segment === '..') {
                        stack.pop();
                        continue;
                }
                stack.push(segment);
        }
        const base = stack.join('/');
        const candidates = [
                base,
                `${base}.ts`,
                `${base}.js`,
                base.replace(/\.js$/, '.ts'),
                base.replace(/\.mjs$/, '.ts'),
                base.replace(/\.cjs$/, '.ts'),
        ];
        return candidates.includes(ledgerPosix);
}

/** One ground-truth consumer (the driver's own scan of the tree). */
export interface GroundTruthConsumer {
        readonly file: string;
        readonly line: number;
        readonly symbols: readonly string[];
}

function toPosix(target: string): string {
        return target.split(nodePath.sep).join('/');
}

async function collectSourceFiles(repoRoot: string): Promise<string[]> {
        const out: string[] = [];
        const extensionsDir = nodePath.join(repoRoot, 'extensions');
        let entries;
        try {
                entries = await nodeFs.readdir(extensionsDir, { withFileTypes: true });
        } catch (err) {
                if ((err as { code?: string }).code === 'ENOENT') {
                        return out;
                }
                throw err;
        }
        const queue = entries.filter(entry => entry.isDirectory() && entry.name.startsWith('flauz-')).map(entry => nodePath.join(extensionsDir, entry.name));
        while (queue.length > 0) {
                const dir = queue.shift() ?? '';
                const children = await nodeFs.readdir(dir, { withFileTypes: true });
                for (const child of children) {
                        const full = nodePath.join(dir, child.name);
                        if (child.isDirectory()) {
                                queue.push(full);
                                continue;
                        }
                        if (SOURCE_EXTENSIONS.has(nodePath.extname(child.name))) {
                                out.push(full);
                        }
                }
        }
        return out.sort();
}

/**
 * The ground-truth scan: every consumer of the ledger module across
 * extensions/flauz-* (file + line + symbols), computed by THIS module's
 * own traversal and regex extraction.
 */
export async function scanLedgerConsumers(repoRoot: string, ledgerModule: string = LEDGER_MODULE): Promise<GroundTruthConsumer[]> {
        const files = await collectSourceFiles(repoRoot);
        const consumers: GroundTruthConsumer[] = [];
        for (const absolute of files) {
                const repoRelative = toPosix(nodePath.relative(repoRoot, absolute));
                let text;
                try {
                        text = await nodeFs.readFile(absolute, { encoding: 'utf-8' });
                } catch {
                        continue;
                }
                const lines = text.split('\n');
                for (let index = 0; index < lines.length; index += 1) {
                        const statement = parseImportStatement(lines[index] ?? '');
                        if (statement === null) {
                                continue;
                        }
                        if (specifierResolvesTo(repoRelative, statement.specifier, ledgerModule)) {
                                consumers.push({ file: repoRelative, line: index + 1, symbols: [...statement.symbols] });
                        }
                }
        }
        return consumers;
}

// ---------------------------------------------------------------------------
// The answer contract + the verifier
// ---------------------------------------------------------------------------

/** One entry of the model's map (as claimed). */
export interface ConsumerEntry {
        readonly file: string;
        readonly line: number;
        readonly consumes: readonly string[];
}

/** The model's parsed answer document. */
export interface ExploreAnswer {
        readonly schema: string;
        readonly consumers: readonly ConsumerEntry[];
}

export type ParseAnswerOutcome = { readonly ok: true; readonly answer: ExploreAnswer; readonly fenceStripped: boolean } | { readonly ok: false; readonly error: string };

/**
 * Parses the streamed completion text as the answer document (typed
 * failure on anything else).
 *
 * P2-FIX-118: with `options.fenceTolerant` (the LIVE lanes) a leading/
 * trailing markdown fence pair around the JSON payload is stripped
 * before the raw parse; malformed JSON inside the fence still FAILS.
 * The default (machine lanes) parses raw JSON only -- unchanged.
 *
 * P2-FIX-120: the fence-tolerant path now ALSO extracts the FIRST
 * COMPLETE fenced block from anywhere in the text (prose before/after
 * allowed -- the live model's conversational wrapping); a text with no
 * complete fence still falls to the raw parse (the honest failure).
 */
export function parseExploreAnswer(text: string, options?: AnswerParseOptions): ParseAnswerOutcome {
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
        if (record.schema !== EXPLORE_ANSWER_SCHEMA) {
                return { ok: false, error: `the answer schema is ${JSON.stringify(record.schema)} but ${JSON.stringify(EXPLORE_ANSWER_SCHEMA)} was expected` };
        }
        if (!Array.isArray(record.consumers)) {
                return { ok: false, error: 'the answer field "consumers" is not an array' };
        }
        const consumers: ConsumerEntry[] = [];
        for (const [index, entry] of record.consumers.entries()) {
                if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
                        return { ok: false, error: `consumers[${String(index)}] is not an object` };
                }
                const row = entry as Record<string, unknown>;
                if (typeof row.file !== 'string' || row.file.length === 0) {
                        return { ok: false, error: `consumers[${String(index)}].file must be a non-empty string` };
                }
                if (typeof row.line !== 'number' || !Number.isInteger(row.line) || row.line < 1) {
                        return { ok: false, error: `consumers[${String(index)}].line must be a positive integer` };
                }
                if (!Array.isArray(row.consumes) || row.consumes.some(symbol => typeof symbol !== 'string')) {
                        return { ok: false, error: `consumers[${String(index)}].consumes must be an array of strings` };
                }
                consumers.push({ file: row.file, line: row.line, consumes: (row.consumes as unknown[]).map(String) });
        }
        return { ok: true, answer: { schema: EXPLORE_ANSWER_SCHEMA, consumers }, fenceStripped: strip.fenced };
}

/** One checked map entry (the receipt's per-entry row). */
export interface MapCheckResult {
        readonly file: string;
        readonly line: number;
        readonly consumes: readonly string[];
        readonly ok: boolean;
        readonly problems: readonly string[];
}

/** The verification receipt (written to disk verbatim by the exercise). */
export interface MapVerification {
        readonly schema: 'flauz.dogfood-explore-verification/v1';
        readonly ledgerModule: string;
        readonly verified: boolean;
        readonly checked: readonly MapCheckResult[];
        readonly missed: readonly GroundTruthConsumer[];
        readonly totals: {
                readonly claimed: number;
                readonly real: number;
                readonly verifiedEntries: number;
                readonly problemEntries: number;
                readonly missedEntries: number;
        };
}

function sameSymbols(claimed: readonly string[], real: readonly string[]): boolean {
        const left = [...claimed].map(symbol => symbol.trim()).filter(symbol => symbol.length > 0).sort();
        const right = [...real].map(symbol => symbol.trim()).filter(symbol => symbol.length > 0).sort();
        return left.length === right.length && left.every((symbol, index) => symbol === right[index]);
}

/**
 * THE VERIFIER: checks the model's map against the driver's own scan.
 * Every claimed entry is re-read from the tree (the line must REALLY
 * import the ledger module and the symbols must match); completeness
 * is exact (every real consumer must appear). 100% verified iff every
 * entry is sound AND nothing is missed AND no duplicates/phantoms.
 */
export async function verifyConsumersMap(answer: ExploreAnswer, groundTruth: readonly GroundTruthConsumer[], repoRoot: string, ledgerModule: string = LEDGER_MODULE): Promise<MapVerification> {
        const truthByKey = new Map<string, GroundTruthConsumer>();
        for (const consumer of groundTruth) {
                truthByKey.set(`${consumer.file}:${String(consumer.line)}`, consumer);
        }
        const seen = new Set<string>();
        const checked: MapCheckResult[] = [];
        for (const entry of answer.consumers) {
                const problems: string[] = [];
                const normalized = toPosix(entry.file);
                if (normalized !== entry.file || normalized.startsWith('/') || normalized.split('/').includes('..')) {
                        problems.push(`file is not a clean repo-relative posix path (${entry.file})`);
                }
                if (!normalized.startsWith('extensions/flauz-')) {
                        problems.push(`file is outside extensions/flauz-* (${normalized})`);
                }
                const key = `${normalized}:${String(entry.line)}`;
                if (seen.has(key)) {
                        problems.push(`duplicate map entry for ${key}`);
                }
                seen.add(key);
                const truth = truthByKey.get(key);
                if (truth === undefined) {
                        const byFile = [...truthByKey.values()].filter(consumer => consumer.file === normalized);
                        problems.push(byFile.length === 0
                                ? `no ledger-import statement resolves at ${key} in the tree (phantom entry)`
                                : `the ledger import of ${normalized} is at line ${String(byFile[0]?.line ?? 0)}, not ${String(entry.line)}`);
                } else if (!sameSymbols(entry.consumes, truth.symbols)) {
                        problems.push(`consumes mismatch at ${key}: claimed [${entry.consumes.join(', ')}] but the line binds [${truth.symbols.join(', ')}]`);
                }
                // the direct re-read: the claimed line must itself import the ledger module
                try {
                        const text = await nodeFs.readFile(nodePath.join(repoRoot, normalized), { encoding: 'utf-8' });
                        const line = text.split('\n')[entry.line - 1] ?? '';
                        const statement = parseImportStatement(line);
                        if (statement === null || !specifierResolvesTo(normalized, statement.specifier, ledgerModule)) {
                                problems.push(`the re-read of ${key} does not import ${ledgerModule} (line reads: ${line.trim().slice(0, 80)})`);
                        } else if (!sameSymbols(entry.consumes, statement.symbols)) {
                                problems.push(`the re-read of ${key} binds [${statement.symbols.join(', ')}], not the claimed [${entry.consumes.join(', ')}]`);
                        }
                } catch (err) {
                        problems.push(`the re-read of ${normalized} failed: ${err instanceof Error ? err.message : String(err)}`);
                }
                checked.push({ file: normalized, line: entry.line, consumes: [...entry.consumes], ok: problems.length === 0, problems });
        }
        const claimedKeys = new Set(checked.map(entry => `${entry.file}:${String(entry.line)}`));
        const missed = groundTruth.filter(consumer => !claimedKeys.has(`${consumer.file}:${String(consumer.line)}`));
        const problemEntries = checked.filter(entry => !entry.ok).length;
        const verified = problemEntries === 0 && missed.length === 0 && checked.length === groundTruth.length;
        return {
                schema: 'flauz.dogfood-explore-verification/v1',
                ledgerModule,
                verified,
                checked,
                missed,
                totals: {
                        claimed: checked.length,
                        real: groundTruth.length,
                        verifiedEntries: checked.length - problemEntries,
                        problemEntries,
                        missedEntries: missed.length,
                },
        };
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

/** Writes one workspace artifact + its evidence row (the journey's mint pattern). */
async function mintArtifact(harness: DogfoodHarness, uri: string, contents: string, note: string): Promise<{ item: EvidenceItem; evidenceId: string }> {
        const absolute = nodePath.join(harness.root, uri);
        await nodeFs.mkdir(nodePath.dirname(absolute), { recursive: true });
        await nodeFs.writeFile(absolute, contents, { encoding: 'utf-8' });
        const sha256 = sha256Hex(contents);
        const appended = await harness.ledger.append(harness.taskId, { kind: 'note', uri, sha256, note });
        await harness.tasks.recordEvidence(harness.taskId, { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'note', uri, sha256, note });
        return { item: { kind: 'note', uri, sha256 }, evidenceId: appended.evidenceId };
}

export const EXPLORE_EXERCISE: DogfoodExercise = {
        id: 'explore-repo',
        title: 'repository exploration: map every consumer of the evidence ledger',
        prompt: EXPLORE_QUESTION,
        dimensions: ['repository exploration', 'artifacts/evidence', 'slow-path timing'],
        async run(harness: DogfoodHarness): Promise<ExerciseReceipt> {
                const recorder = new Recorder();
                const evidenceIds: string[] = [];
                const evidenceItems: EvidenceItem[] = [];
                const notes: string[] = [];

                // (1) the exploration turn through the Model Fabric (route + stream)
                const askStartedAt = Date.now();
                const outcome = await harness.provider.ask(EXPLORE_QUESTION);
                const askDurationMs = Date.now() - askStartedAt;
                await harness.friction.timing({ phase: 'explore-repo:model-call', durationMs: askDurationMs, wallClockBudgetMs: outcome.wallClockBudgetMs });
                if (outcome.kind !== 'ok') {
                        await harness.friction.friction({
                                phase: 'explore-repo:model-call',
                                kind: 'provider-failure',
                                detail: `the exploration turn failed with the typed provider failure ${outcome.code} (${outcome.retryClass}, ${String(outcome.attempts)} attempts): ${outcome.message}`,
                                recovery: '',
                        });
                        recorder.check('explore.model-call-ok', false, `the exploration turn failed: ${outcome.message}`);
                        return {
                                schema: 'flauz.dogfood-exercise-receipt/v1',
                                exerciseId: 'explore-repo',
                                title: 'repository exploration: map every consumer of the evidence ledger',
                                dimensions: ['repository exploration', 'artifacts/evidence', 'slow-path timing'],
                                verdict: 'FAIL',
                                checks: recorder.checks,
                                evidenceIds,
                                evidenceItems,
                                frictionLogPath: harness.friction.path,
                                frictionRows: { friction: 1, timing: 1, recovery: 0 },
                                evidenceLevels: { seams: 'local-real', modelIntelligence: 'fixture' },
                                notes,
                        };
                }
                recorder.check('explore.model-call-ok', true, `the exploration turn streamed ${String(outcome.text.length)} chars through provider ${outcome.providerId} (decision ${outcome.decisionId}, ${String(outcome.attempts)} attempt(s), ${String(askDurationMs)} ms, ${finishReasonDetail(outcome.finishReason)})`);

                // (2) parse the answer document (P2-FIX-118: live lanes parse through
                // the fence-tolerant path; machine lanes keep the raw-JSON default)
                const parsed = parseExploreAnswer(outcome.text, { fenceTolerant: harness.mode === 'live-provider' });
                if (!parsed.ok) {
                        // P2-FIX-121: the parse-failure receipt detail carries the finish
                        // reason; a `length` finish appends the VISIBLE TRUNCATED marker --
                        // the live exploration run's answer parses, or fails with a VISIBLE
                        // truncation marker, never a bare raw-parse error again.
                        await harness.friction.friction({
                                phase: 'explore-repo:parse-answer',
                                kind: 'failed-task',
                                detail: `the completion did not parse as the answer document: ${answerParseFailDetail(parsed.error, outcome.finishReason)}`,
                                recovery: '',
                        });
                        recorder.check('explore.answer-parses', false, answerParseFailDetail(parsed.error, outcome.finishReason));
                        return {
                                schema: 'flauz.dogfood-exercise-receipt/v1',
                                exerciseId: 'explore-repo',
                                title: 'repository exploration: map every consumer of the evidence ledger',
                                dimensions: ['repository exploration', 'artifacts/evidence', 'slow-path timing'],
                                verdict: 'FAIL',
                                checks: recorder.checks,
                                evidenceIds,
                                evidenceItems,
                                frictionLogPath: harness.friction.path,
                                frictionRows: { friction: 1, timing: 1, recovery: 0 },
                                evidenceLevels: { seams: 'local-real', modelIntelligence: 'fixture' },
                                notes,
                        };
                }
                recorder.check('explore.answer-parses', true, `the answer document carries ${String(parsed.answer.consumers.length)} claimed consumers`);

                // (3) the driver's OWN scan of the tree (the ground truth -- never the model's word)
                const scanStartedAt = Date.now();
                const groundTruth = await scanLedgerConsumers(harness.repoRoot);
                const scanDurationMs = Date.now() - scanStartedAt;
                await harness.friction.timing({ phase: 'explore-repo:driver-verification', durationMs: scanDurationMs });

                // (4) the verification: every claimed file:line receipt real + completeness exact
                const verification = await verifyConsumersMap(parsed.answer, groundTruth, harness.repoRoot);
                recorder.check('explore.map-sound', verification.totals.problemEntries === 0, `every claimed entry re-reads as a real ledger import (${String(verification.totals.claimed - verification.totals.problemEntries)}/${String(verification.totals.claimed)} sound)`);
                recorder.check('explore.map-complete', verification.totals.missedEntries === 0, `the map misses ${String(verification.totals.missedEntries)} of the ${String(verification.totals.real)} real consumers`);
                recorder.check('explore.map-100-percent', verification.verified, `claimed ${String(verification.totals.claimed)} vs real ${String(verification.totals.real)}; verified=${String(verification.verified)}`);

                // (5) the artifacts + evidence chain (the answer AS RECEIVED + the verification receipt)
                const answerUri = `.flauz/artifacts/${harness.taskId}/explore-answer.json`;
                const answerArtifact = await mintArtifact(harness, answerUri, outcome.text, `the exploration answer as received over the wire (provider ${outcome.providerId}, decision ${outcome.decisionId})`);
                evidenceItems.push(answerArtifact.item);
                evidenceIds.push(answerArtifact.evidenceId);
                const verificationUri = `.flauz/artifacts/${harness.taskId}/explore-verification.json`;
                const verificationArtifact = await mintArtifact(harness, verificationUri, `${JSON.stringify(verification, null, '\t')}\n`, 'the driver-side verification receipt (the checked map)');
                evidenceItems.push(verificationArtifact.item);
                evidenceIds.push(verificationArtifact.evidenceId);
                // the records-dir copy: the verification receipt is a mandated run receipt (the workspace root is ephemeral)
                await nodeFs.mkdir(harness.recordsDir, { recursive: true });
                await nodeFs.writeFile(nodePath.join(harness.recordsDir, 'explore-repo.verification.json'), `${JSON.stringify(verification, null, '\t')}\n`, { encoding: 'utf-8' });
                recorder.check('explore.evidence-minted', evidenceItems.length === 2 && evidenceIds.length === 2, `the answer + verification artifacts are hash-pinned into the evidence ledger (${evidenceIds.join(', ')})`);

                // (6) honest friction: only what actually happened
                if (!verification.verified) {
                        const firstProblem = verification.checked.find(entry => !entry.ok)?.problems[0] ?? 'no problem detail';
                        await harness.friction.friction({
                                phase: 'explore-repo:verify',
                                kind: 'failed-task',
                                detail: `the exploration map is not 100% verified: ${String(verification.totals.problemEntries)} problem entries, ${String(verification.totals.missedEntries)} missed; first problem: ${firstProblem}`,
                                recovery: '',
                        });
                }
                notes.push(`the fake lane computed its map live from the tree (the provider's own scan); the driver verified every receipt independently (regex scanner + per-entry re-read)`);
                notes.push(`model intelligence: fixture (the scripted fake lane); seams: local-real (task envelope, session claim, routing decision, adapter stream, evidence ledger)`);

                const failCount = recorder.checks.filter(check => !check.ok).length;
                const frictionRows = await harness.friction.readAll();
                return {
                        schema: 'flauz.dogfood-exercise-receipt/v1',
                        exerciseId: 'explore-repo',
                        title: 'repository exploration: map every consumer of the evidence ledger',
                        dimensions: ['repository exploration', 'artifacts/evidence', 'slow-path timing'],
                        verdict: failCount === 0 ? 'PASS' : 'FAIL',
                        checks: recorder.checks,
                        evidenceIds,
                        evidenceItems,
                        frictionLogPath: harness.friction.path,
                        frictionRows: {
                                friction: frictionRows.filter(row => row.type === 'friction').length,
                                timing: frictionRows.filter(row => row.type === 'timing').length,
                                recovery: frictionRows.filter(row => row.type === 'friction' && typeof row.recovery === 'string' && row.recovery.length > 0).length,
                        },
                        evidenceLevels: { seams: 'local-real', modelIntelligence: 'fixture' },
                        notes,
                };
        },
};
