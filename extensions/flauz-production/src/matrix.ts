/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The capability matrix (A-PROD-005-W1 -- the production-readiness plane's
 * second surface, the roadmap's final prove-item: "documented
 * supported/unsupported capabilities").
 *
 * THE DERIVATION LAW: the matrix's row set DERIVES FROM THE REAL REGISTRY
 * SURFACES -- the repo-state product registry's extension manifests (the
 * contributed command ids) -- never a hardcoded list that can drift. The
 * documented catalog (capabilities.ts) supplies each row's STATEMENTS; the
 * live manifests supply the row SET. The two directions of disclosure:
 *
 *   unknown -- a command the live product carries that NO catalog entry
 *              claims: the matrix renders it as a typed UNKNOWN row (the
 *              product grew a surface the documentation was never told
 *              about; the matrix refuses to guess a boundary);
 *   drift   -- a catalog entry whose commands are ABSENT from the live
 *              product: the documentation no longer matches the shipped
 *              surface (a removed/renamed command).
 *
 * Both disclosure classes hold the matrix verdict at NOT-CLOSED (ok=false)
 * -- an undocumented capability or a stale documentation row is a real
 * defect of the "documented capabilities" prove-item, never a silent pass.
 *
 * THE ARTIFACT: `.flauz/production/matrix-<stamp>.json`
 * (flauz.production-matrix/v1) -- the machine-readable half; the rendered
 * table is the human-readable half (the command's channel surface). Swept
 * fail-closed, banked census-visible, the watermark re-synced.
 */

import {
        type Clock,
        type ProductionFsPort,
        type VersionsInfo,
        EXTENSION_ID,
        MATRIX_PREFIX,
        MATRIX_SCHEMA_ID,
        PRODUCTION_DIR,
        joinPath,
        serializeArtifact,
} from './api.ts';
import { readProductState, type ProductState } from './productState.ts';
import { CAPABILITY_CATALOG, catalogClosure, type CapabilityDef } from './capabilities.ts';
import { sweepArtifact } from './privacy.ts';
import { bankLedgerRowFor, type BankingOutcome } from './banking.ts';
import { toIsoStamp } from './format.ts';

// ---------------------------------------------------------------------------
// The row shapes
// ---------------------------------------------------------------------------

/** One matrix row's status (the documentation-truth vocabulary). */
export type MatrixRowStatus = 'documented' | 'unknown' | 'drift';

/** One matrix row (a capability as the matrix renders it). */
export interface MatrixRow {
        /** The capability id (catalog key) or the raw command id (the unknown disclosure). */
        readonly id: string;
        /** The owning extension's directory name. */
        readonly owner: string;
        /** The row's status: documented (the catalog entry matches the live surface), unknown, drift. */
        readonly status: MatrixRowStatus;
        /** The owning command ids as the LIVE product carries them. */
        readonly commands: readonly string[];
        /** The evidence class: which wave landed the capability + which gate certifies it. */
        readonly wave: string;
        readonly gate: string;
        /** The SUPPORTED envelope (documented rows only). */
        readonly supported: string;
        /** The honest UNSUPPORTED boundary (documented rows only). */
        readonly unsupported: string;
        /** The disclosure reason (unknown/drift rows only). */
        readonly reason?: string;
}

/** The whole matrix result (the `flauz.production.matrix` surface). */
export interface CapabilityMatrixResult {
        readonly ok: boolean;
        readonly createdAt: number;
        readonly productRoot: string;
        readonly rows: readonly MatrixRow[];
        readonly counts: {
                readonly documentedCount: number;
                readonly unknownCount: number;
                readonly driftCount: number;
                readonly catalogClosureClosed: boolean;
        };
        readonly catalogProblems: readonly string[];
}

/** Deps of the matrix. */
export interface MatrixDeps {
        readonly root: string;
        readonly fs: ProductionFsPort;
        readonly clock: Clock;
        /** The repo-state product root (the caller's typed refusal owns the absent case). */
        readonly productRoot: string;
}

// ---------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------

/** Collects the live command surface from the product state: command -> owner name. */
function liveCommandSurface(product: ProductState): Map<string, string> {
        const surface = new Map<string, string>();
        for (const extension of product.extensions) {
                if (!extension.manifestPresent || extension.parseError !== undefined) {
                        continue;
                }
                for (const command of extension.commands) {
                        surface.set(command, extension.name);
                }
        }
        return surface;
}

/** Builds one documented-or-drift row from a catalog entry + the live surface. */
function catalogRow(entry: CapabilityDef, liveSurface: Map<string, string>): MatrixRow {
        const present = entry.commands.filter(command => liveSurface.has(command));
        const absent = entry.commands.filter(command => !liveSurface.has(command));
        if (absent.length > 0) {
                return {
                        id: entry.id,
                        owner: entry.owner,
                        status: 'drift',
                        commands: present,
                        wave: entry.wave,
                        gate: entry.gate,
                        supported: entry.supported,
                        unsupported: entry.unsupported,
                        reason: `the documented command(s) [${absent.join(', ')}] are absent from the live product surface -- the documentation no longer matches the shipped capability`,
                };
        }
        return {
                id: entry.id,
                owner: entry.owner,
                status: 'documented',
                commands: entry.commands,
                wave: entry.wave,
                gate: entry.gate,
                supported: entry.supported,
                unsupported: entry.unsupported,
        };
}

/**
 * Derives the whole matrix: one row per catalog entry (documented or drift)
 * + one row per unknown live command (grouped by owner extension). The
 * catalog closure problems ride the result (the catalog's own hygiene is
 * part of the matrix's truth).
 */
export function deriveMatrix(product: ProductState): CapabilityMatrixResult {
        const closure = catalogClosure();
        const liveSurface = liveCommandSurface(product);
        const rows: MatrixRow[] = [];

        const catalogCommands = new Set<string>();
        for (const entry of CAPABILITY_CATALOG) {
                for (const command of entry.commands) {
                        catalogCommands.add(command);
                }
        }

        // the documented-or-drift rows, in catalog order
        for (const entry of CAPABILITY_CATALOG) {
                rows.push(catalogRow(entry, liveSurface));
        }

        // the unknown rows: live commands no catalog entry claims, grouped by owner
        const unknownByOwner = new Map<string, string[]>();
        for (const [command, owner] of [...liveSurface.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
                if (!catalogCommands.has(command)) {
                        const list = unknownByOwner.get(owner) ?? [];
                        list.push(command);
                        unknownByOwner.set(owner, list);
                }
        }
        for (const [owner, commands] of [...unknownByOwner.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
                rows.push({
                        id: `undocumented:${owner}`,
                        owner,
                        status: 'unknown',
                        commands,
                        wave: '(no catalog entry)',
                        gate: '(no catalog entry)',
                        supported: '(the matrix refuses to guess a boundary it was never told)',
                        unsupported: '(undocumented -- the capability catalog must grow an entry before this row can carry statements; the matrix refuses to guess a boundary for a capability it was never told about)',
                        reason: `the live product carries command(s) [${commands.join(', ')}] that NO catalog entry claims -- an undocumented capability, disclosed`,
                });
        }

        const documentedCount = rows.filter(row => row.status === 'documented').length;
        const unknownCount = rows.filter(row => row.status === 'unknown').length;
        const driftCount = rows.filter(row => row.status === 'drift').length;
        const ok = closure.closed && unknownCount === 0 && driftCount === 0;
        return {
                ok,
                createdAt: 0, // the caller stamps the result
                productRoot: product.productRoot,
                rows,
                counts: { documentedCount, unknownCount, driftCount, catalogClosureClosed: closure.closed },
                catalogProblems: closure.problems,
        };
}

/**
 * Runs the capability matrix end-to-end: reads the product registry,
 * derives the rows, stamps the result. Never persists (the caller owns
 * persistence).
 */
export async function runMatrix(deps: MatrixDeps): Promise<CapabilityMatrixResult> {
        const createdAt = deps.clock();
        const product = await readProductState(deps.productRoot, deps.fs);
        if (product === undefined) {
                throw new Error(`flauz.production.matrix: ${deps.productRoot} carries no extensions/ directory -- not a repo-state product registry (the caller owns the typed refusal)`);
        }
        const result = deriveMatrix(product);
        return { ...result, createdAt };
}

// ---------------------------------------------------------------------------
// The persisted artifact
// ---------------------------------------------------------------------------

/** The matrix artifact body (`.flauz/production/matrix-<stamp>.json`). */
export interface CapabilityMatrixArtifact {
        readonly $schema: typeof MATRIX_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly createdAt: number;
        readonly productName: string;
        readonly productVersion: string;
        readonly extensionId: typeof EXTENSION_ID;
        readonly extensionVersion: string;
        readonly workspaceRoot: string;
        readonly productRoot: string;
        readonly commandLine: 'flauz.production.matrix';
        readonly ok: boolean;
        readonly counts: CapabilityMatrixResult['counts'];
        readonly catalogProblems: readonly string[];
        readonly rows: readonly MatrixRow[];
        readonly privacyLaw: string;
}

/** The filename-safe stamp of a matrix artifact (the export-stamp convention). */
export function matrixStamp(epochMs: number): string {
        return toIsoStamp(epochMs).replaceAll(':', '');
}

/** The persisted outcome. */
export interface PersistedMatrix {
        readonly artifactPath: string;
        readonly artifact: CapabilityMatrixArtifact;
        readonly banking: BankingOutcome;
}

/**
 * Persists the matrix artifact workspace-locally + banks it census-visible:
 * sweeps the artifact (fail-closed), writes
 * `.flauz/production/matrix-<stamp>.json` (DL-9 serialization), then appends
 * the evidence-ledger note row with the watermark re-sync.
 */
export async function persistMatrix(deps: { root: string; fs: ProductionFsPort; clock: Clock }, versions: VersionsInfo, result: CapabilityMatrixResult): Promise<PersistedMatrix> {
        const artifact: CapabilityMatrixArtifact = {
                $schema: MATRIX_SCHEMA_ID,
                schemaVersion: 0,
                createdAt: result.createdAt,
                productName: versions.productName,
                productVersion: versions.productVersion,
                extensionId: EXTENSION_ID,
                extensionVersion: versions.extensions.find(extension => extension.id === EXTENSION_ID)?.version ?? 'unknown',
                workspaceRoot: deps.root,
                productRoot: result.productRoot,
                commandLine: 'flauz.production.matrix',
                ok: result.ok,
                counts: result.counts,
                catalogProblems: result.catalogProblems,
                rows: result.rows,
                privacyLaw: 'METADATA-ONLY: surface shapes (capability ids, owning commands, evidence classes, verdicts, counts) -- never contents; swept for secret-shaped values before write (fail-closed, the W1/W5 posture).',
        };
        sweepArtifact(artifact, 'matrix-artifact');
        const artifactText = serializeArtifact(artifact);
        const dirName = `${MATRIX_PREFIX}${matrixStamp(result.createdAt)}`;
        const artifactPath = joinPath(deps.root, PRODUCTION_DIR, `${dirName}.json`);
        await deps.fs.mkdir(joinPath(deps.root, PRODUCTION_DIR));
        await deps.fs.writeFile(artifactPath, artifactText);
        const banking = await bankLedgerRowFor({ root: deps.root, fs: deps.fs, clock: deps.clock }, artifactText, joinPath(PRODUCTION_DIR, `${dirName}.json`));
        return { artifactPath, artifact, banking };
}

// ---------------------------------------------------------------------------
// The render (the human-readable half)
// ---------------------------------------------------------------------------

/** Renders the matrix (the `flauz.production.matrix` channel surface). */
export function renderMatrix(result: CapabilityMatrixResult): readonly string[] {
        const lines: string[] = [];
        lines.push(`flauz.production.matrix: the capability matrix -- verdict ${result.ok ? 'CLOSED (every live capability documented, every documented capability live)' : 'NOT-CLOSED (the documentation and the shipped surface disagree)'}`);
        lines.push(`  product registry: ${result.productRoot} (rows derived from the live manifests' contributed commands -- never a hardcoded list)`);
        lines.push(`  counts: ${String(result.counts.documentedCount)} documented, ${String(result.counts.unknownCount)} unknown (undocumented live commands), ${String(result.counts.driftCount)} drift (documented-but-absent commands), catalog closure ${result.counts.catalogClosureClosed ? 'closed' : 'OPEN'}`);
        for (const problem of result.catalogProblems) {
                lines.push(`  catalog problem: ${problem}`);
        }
        lines.push('  rows:');
        for (const row of result.rows) {
                const marker = row.status === 'documented' ? '[DOCUMENTED]' : row.status === 'unknown' ? '[UNKNOWN  ]' : '[DRIFT    ]';
                lines.push(`    ${marker} ${row.id.padEnd(32)} owner=${row.owner} commands=${String(row.commands.length)}`);
                if (row.status === 'documented') {
                        lines.push(`      supported:   ${row.supported}`);
                        lines.push(`      unsupported: ${row.unsupported}`);
                        lines.push(`      evidence:    ${row.wave} -- ${row.gate}`);
                } else if (row.reason !== undefined) {
                        lines.push(`      ${row.reason}`);
                }
        }
        return lines;
}
