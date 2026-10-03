/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared fixture boot for the flauz-durability suite (A-PROD-005-W4).
 *
 * EVIDENCE LEVEL -- local-real: the fixture workspaces carry REAL `.flauz/`
 * trees (real evidence-ledger + watermark bodies, real lane registries +
 * heartbeat rings written through THIS extension's real writers); the
 * checkpoint-law consultation's subject is a REAL W3 isolation audit record
 * produced by the REAL flauz-isolation machinery (runAudit + persistAudit
 * over a real-shaped product registry fixture -- test-time cross-extension
 * imports of the owning src, the sanctioned pin pattern; src never crosses)
 * and a REAL W2 export anchor produced by the REAL flauz-backup export
 * builder (createExport through the W2 ports). Never claim runtime-real for
 * cross-process supervision (the record-keeping-vs-execution boundary is
 * the disclosed honest boundary).
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { DurabilityFsPort } from '../src/api.ts';
import { sha256Hex, serializeWatermark } from '../src/api.ts';

// --- the REAL owning machinery (test-time cross-extension imports; the pin pattern) ---
import { runAudit, persistAudit } from '../../flauz-isolation/src/audit.ts';
import type { IsolationFsPort } from '../../flauz-isolation/src/api.ts';
import { createExport } from '../../flauz-backup/src/export.ts';
import type { BackupFsPort, VersionsInfo } from '../../flauz-backup/src/api.ts';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

/** The real repo root (the contract suite's local-real subject). */
export const repoRoot = REPO_ROOT;

/** Deterministic but distinguishable timestamps (advances 1000 per call). */
export function steppingClock(start = 1_740_100_000_000): () => number {
        let current = start;
        return () => {
                const value = current;
                current += 1000;
                return value;
        };
}

/**
 * The flauz-durability DurabilityFsPort over node:fs (the extension-host
 * wiring, mirrored in the test lane). Carries the readlink probe the REAL
 * W3 audit machinery's boundary scan needs (a superset of this extension's
 * own port -- structural typing satisfies both).
 */
export function nodeDurabilityFs(): DurabilityFsPort & IsolationFsPort & BackupFsPort {
        return {
                readFileUtf8: async target => {
                        try {
                                return await fs.readFile(target, { encoding: 'utf-8' });
                        } catch (err) {
                                if ((err as { code?: string }).code === 'ENOENT') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                readdir: async target => {
                        try {
                                return await fs.readdir(target);
                        } catch (err) {
                                const code = (err as { code?: string }).code;
                                if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                readlink: async target => {
                        try {
                                return await fs.readlink(target);
                        } catch (err) {
                                const code = (err as { code?: string }).code;
                                if (code === 'ENOENT' || code === 'EINVAL' || code === 'EACCES' || code === 'EPERM') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                mkdir: target => fs.mkdir(target, { recursive: true }),
                writeFile: (target, contents) => fs.writeFile(target, contents, { encoding: 'utf-8' }),
                appendFile: (target, contents) => fs.appendFile(target, contents, { encoding: 'utf-8' }),
                rename: async (fromPath, toPath) => fs.rename(fromPath, toPath),
        };
}

/**
 * The write-refusing fs port (the read-only law's proof vehicle): every
 * write surface throws; the read surface delegates to the real port. A
 * command that completes against this port has provably written nothing.
 */
export function writeRefusingFs(base: DurabilityFsPort): DurabilityFsPort {
        const refuse = async (): Promise<never> => {
                throw new Error('flauz-durability/test: WRITE REFUSED (the read-only law: this command must not write)');
        };
        return {
                readFileUtf8: base.readFileUtf8,
                readdir: base.readdir,
                mkdir: () => refuse(),
                writeFile: () => refuse(),
                appendFile: () => refuse(),
        };
}

/** A fresh temp workspace root (mkdtemp; cleanup removes the tree). */
export async function tempRoot(prefix: string): Promise<{ root: string; cleanup: () => Promise<void> }> {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
        return {
                root,
                cleanup: async () => {
                        await fs.rm(root, { recursive: true, force: true });
                },
        };
}

// ---------------------------------------------------------------------------
// The fixture product registry (real manifests + parity registry + SBOM)
// ---------------------------------------------------------------------------

/** The extension set the fixture registry carries: the real 18 + this wave's own (the branch tree's 19). */
export const FIXTURE_EXTENSION_NAMES: readonly string[] = [
        'flauz-agent',
        'flauz-backup',
        'flauz-browser',
        'flauz-diagnostics',
        'flauz-durability',
        'flauz-environments',
        'flauz-execution',
        'flauz-integrity',
        'flauz-isolation',
        'flauz-lab',
        'flauz-memory',
        'flauz-migration',
        'flauz-models',
        'flauz-production',
        'flauz-release',
        'flauz-resources',
        'flauz-telemetry',
        'flauz-workflow',
        'flauz-workspace',
];

/** One real-shaped extension manifest for the fixture registry. */
function fixtureManifest(name: string): Record<string, unknown> {
        const short = name.replace(/^flauz-/, '');
        return {
                name,
                displayName: `Fixture ${name}`,
                description: `the ${name} fixture extension (durability test lane)`,
                version: '0.1.0',
                publisher: 'flauz',
                license: 'MIT',
                type: 'module',
                engines: { vscode: '^1.140.0' },
                categories: ['Other'],
                activationEvents: [`onCommand:flauz.${short}.thing`],
                main: './dist/extension.js',
                contributes: { commands: [{ command: `flauz.${short}.thing`, title: `Fixture ${short} Thing`, category: 'Flauz' }] },
        };
}

/**
 * Boots a fixture repo-state product into `root` (real manifests + a real
 * parity registry body + a real SBOM body; the extension set is the real
 * 19-extension registry shape -- the branch tree's registry).
 */
export async function plantFixtureProduct(root: string): Promise<void> {
        for (const name of [...FIXTURE_EXTENSION_NAMES].sort()) {
                await fs.mkdir(path.join(root, 'extensions', name, 'src'), { recursive: true });
                await fs.writeFile(path.join(root, 'extensions', name, 'package.json'), `${JSON.stringify(fixtureManifest(name), null, 2)}\n`, 'utf-8');
                await fs.writeFile(path.join(root, 'extensions', name, 'src', 'api.ts'), 'export const fixture = 1;\n', 'utf-8');
        }
        await fs.mkdir(path.join(root, 'build', 'flauz', 'security'), { recursive: true });
        const parity = { version: 1, description: 'fixture parity registry (durability test lane)', rows: FIXTURE_EXTENSION_NAMES.map(name => ({ surface: `extensions/${name}`, capability: 'fixture posture', class: 'web-blocked', reason: 'fixture row', evidence: [], recoveryPath: 'fixture' })) };
        await fs.writeFile(path.join(root, 'build', 'flauz', 'packaging-parity.json'), `${JSON.stringify(parity, null, 2)}\n`, 'utf-8');
        const sbom = {
                $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
                bomFormat: 'CycloneDX',
                specVersion: '1.5',
                serialNumber: 'urn:uuid:00000000-0000-0000-0000-000000000000',
                version: 1,
                metadata: {},
                components: FIXTURE_EXTENSION_NAMES.map(name => ({ type: 'library', 'bom-ref': `pkg:generic/flauz/${name}@0.1.0`, name, version: '0.1.0', purl: `pkg:generic/flauz/${name}@0.1.0` })),
                dependencies: [],
        };
        await fs.writeFile(path.join(root, 'build', 'flauz', 'security', 'flauz-sbom.json'), `${JSON.stringify(sbom, null, 2)}\n`, 'utf-8');
}

// ---------------------------------------------------------------------------
// The real .flauz/ fixture bodies (the W1 census surfaces that resolve)
// ---------------------------------------------------------------------------

/**
 * Plants the real fresh-workspace evidence bodies: an empty (fresh) evidence
 * ledger + its TRUE watermark (rowCount 0, bytes 0, head = sha256('')) and,
 * when asked, the flauz-workspace tasks envelope (the surface a lane's
 * state-durability consultation resolves).
 */
export async function plantEvidenceBodies(root: string, options: { readonly withTasks?: boolean } = {}): Promise<void> {
        await fs.mkdir(path.join(root, '.flauz', 'evidence'), { recursive: true });
        await fs.writeFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), '', 'utf-8');
        const watermark = serializeWatermark({ $schema: 'flauz.evidence.size/v1', rowCount: 0, bytes: 0, headSha256: sha256Hex(''), lastCheckpointSeq: null, updatedAt: 1_740_100_000_000 });
        await fs.writeFile(path.join(root, '.flauz', 'evidence', 'size.json'), watermark, 'utf-8');
        if (options.withTasks === true) {
                await fs.writeFile(path.join(root, '.flauz', 'tasks.json'), `${JSON.stringify({ $schema: 'flauz.tasks/v1', schemaVersion: 0, tasks: [] }, null, 2)}\n`, 'utf-8');
        }
}

// ---------------------------------------------------------------------------
// The REAL W3 + W2 machinery drivers (the pin pattern; src never crosses)
// ---------------------------------------------------------------------------

/**
 * Produces a REAL isolation audit record in `root` by running the REAL W3
 * machinery (runAudit + persistAudit) over the planted product fixture.
 * The durability status command's checkpoint law consults exactly this
 * record -- never a hand-written imitation.
 */
export async function plantIsolationAuditRecord(root: string, fsPort: DurabilityFsPort & IsolationFsPort, clock: () => number): Promise<void> {
        const result = await runAudit({ root, productRoot: root, fs: fsPort, clock });
        await persistAudit({ root, fs: fsPort, clock }, result.record);
}

/**
 * Produces a REAL W2 export anchor in `root` by running the REAL backup
 * export builder (createExport through the W2 ports). The durability status
 * command's export-anchor consultation resolves exactly this banked export
 * -- never a hand-written imitation.
 */
export async function plantBackupExport(root: string, fsPort: DurabilityFsPort & BackupFsPort, clock: () => number): Promise<void> {
        const versions: VersionsInfo = { productVersion: '0.1.0', productName: 'Flauz', extensions: [{ id: 'flauz.flauz-backup', version: '0.1.0' }] };
        await createExport({ root, fs: fsPort, clock, versions });
}
