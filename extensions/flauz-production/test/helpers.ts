/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared fixture boot for the flauz-production suite (A-PROD-005-W1).
 *
 * EVIDENCE LEVEL -- local-real: the fixture workspaces and fixture products
 * are constructed as REAL trees (real `extensions/<name>/package.json`
 * manifests, a real parity registry, a real SBOM, a real bundle manifest,
 * real durable-state files with their owning schema ids); the fixture
 * runtime port enumerates a real install tree exactly as vscode.extensions.all
 * would (ids from publisher+name, versions from the manifests). The REAL
 * repo root is also a product state AND an install tree -- the strongest
 * local-real receipt (the live 15-extension product with this wave's rows).
 *
 * Never claim runtime-real for the installed-APP census (no live install
 * target in the worker sandbox -- the honest degradation is itself a
 * certified behavior; the port is the seam a real install drives).
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ProductionFsPort, Clock } from '../src/api.ts';
import type { InstalledProductPort, RuntimeExtensionInfo } from '../src/installedProduct.ts';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

/** The real repo root (the live repo-state product AND a live install tree -- the local-real receipt's subject). */
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

/** The flauz-production ProductionFsPort over node:fs (the extension-host wiring). */
export function nodeProductionFs(): ProductionFsPort {
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
                                // Unlistable = missing (ENOENT) OR a non-directory (ENOTDIR):
                                // undefined in both cases (the ProductionFsPort.readdir contract).
                                const code = (err as { code?: string }).code;
                                if (code === 'ENOENT' || code === 'ENOTDIR') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                mkdir: target => fs.mkdir(target, { recursive: true }),
                writeFile: (target, contents) => fs.writeFile(target, contents, { encoding: 'utf-8' }),
                appendFile: (target, contents) => fs.appendFile(target, contents, { encoding: 'utf-8' }),
        };
}

// ---------------------------------------------------------------------------
// The fixture runtime ports (the installed-product seam, fixture-driven)
// ---------------------------------------------------------------------------

/**
 * A fixture InstalledProductPort over an install tree: enumerates the
 * `extensions/flauz-*` directories of `installRoot` exactly as the runtime
 * would report them (id from publisher+name; version from the scan-time
 * snapshot when given, else the manifest's). The port is driven by a real
 * manifest tree, never a hand-written list -- the fixture lane's honesty.
 *
 * The scan-time snapshot (`scanTimeVersions`, keyed by extension dir name)
 * is the runtime's in-memory truth: the versions the manifests carried when
 * the runtime SCANNED the tree. The tamper fixtures edit the tree AFTER the
 * scan (a deleted manifest, a rewritten version) -- the port keeps reporting
 * the extension (its directory was scanned, so the runtime loaded it) with
 * the scan-time version, and the census's runtime-vs-disk consistency check
 * discovers the disagreement.
 */
export function runtimePortFor(installRoot: string, scanTimeVersions?: Readonly<Record<string, string>>): InstalledProductPort {
        return {
                listFlauzExtensions: async () => {
                        const entries = await fs.readdir(path.join(installRoot, 'extensions')).catch((err: { code?: string }) => {
                                if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
                                        return undefined;
                                }
                                throw err;
                        });
                        if (entries === undefined) {
                                return undefined;
                        }
                        const infos: RuntimeExtensionInfo[] = [];
                        for (const name of [...entries].filter(entry => /^flauz-[a-z0-9-]+$/.test(entry)).sort()) {
                                const manifestPath = path.join(installRoot, 'extensions', name, 'package.json');
                                const text = await fs.readFile(manifestPath, 'utf-8').catch((err: { code?: string }) => {
                                        if (err.code === 'ENOENT') {
                                                return undefined;
                                        }
                                        throw err;
                                });
                                // the directory was scanned -> the runtime loaded it; a
                                // manifest deleted after the scan still yields a runtime
                                // info (the census's torn class discovers the missing
                                // on-disk manifest through the port's extensionPath)
                                let id = `flauz.${name}`;
                                let version = scanTimeVersions?.[name];
                                if (text !== undefined) {
                                        try {
                                                const parsed = JSON.parse(text) as Record<string, unknown>;
                                                const publisher = typeof parsed.publisher === 'string' ? parsed.publisher : 'flauz';
                                                const manifestName = typeof parsed.name === 'string' ? parsed.name : name;
                                                id = `${publisher}.${manifestName}`;
                                                if (version === undefined) {
                                                        version = typeof parsed.version === 'string' ? parsed.version : '0.0.0';
                                                }
                                        } catch {
                                                // an unparseable manifest still yields a runtime info (the census reads + classifies the manifest itself)
                                        }
                                }
                                infos.push({ id, version: version ?? '0.0.0', extensionPath: path.join(installRoot, 'extensions', name) });
                        }
                        return infos;
                },
        };
}

/** The absent runtime surface (the worker sandbox's honest state: no installed product at all). */
export function absentRuntimePort(): InstalledProductPort {
        return { listFlauzExtensions: async () => undefined };
}

/** The empty runtime surface (the runtime enumerated and loaded ZERO flauz extensions). */
export function emptyRuntimePort(): InstalledProductPort {
        return { listFlauzExtensions: async () => [] };
}

/** A hand-built runtime port over explicit infos (the version/id mismatch fixtures). */
export function explicitRuntimePort(infos: readonly RuntimeExtensionInfo[]): InstalledProductPort {
        return { listFlauzExtensions: async () => [...infos].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
}

// ---------------------------------------------------------------------------
// The fixture install tree (the dist-tree manifests the runtime reports)
// ---------------------------------------------------------------------------

/** The injectable defects of a fixture install tree. */
export interface FixtureInstallOptions {
        /** flauz-beta's manifest is DELETED (the torn install class). */
        readonly missingManifest?: boolean;
        /** flauz-beta's manifest is UNPARSEABLE (the torn class). */
        readonly unparseableManifest?: boolean;
        /** flauz-beta's manifest declares a DIFFERENT version than the runtime loaded (the tampered class). */
        readonly versionMismatch?: boolean;
        /** flauz-beta's manifest carries a foreign publisher (the id-law tampered class). */
        readonly publisherMismatch?: boolean;
        /** flauz-alpha's manifest carries '*' activation (the laws tampered class). */
        readonly wildcardActivation?: boolean;
        /** flauz-alpha's manifest loses its main entrypoint (the laws tampered class). */
        readonly missingMain?: boolean;
        /** flauz-gamma is installed but named by NO registry surface (the unknown-extension class). */
        readonly unknownExtension?: boolean;
        /** flauz-beta is expected by the registry but NOT installed (the missing-extension class). */
        readonly skipBeta?: boolean;
}

/** A well-formed command-only fixture manifest. */
function fixtureInstallManifest(name: string, options: FixtureInstallOptions): Record<string, unknown> {
        const commandName = name.replace(/^flauz-/, '');
        const manifest: Record<string, unknown> = {
                name,
                displayName: `Fixture ${name}`,
                description: `the ${name} fixture extension (install tree)`,
                version: '0.1.0',
                publisher: options.publisherMismatch && name === 'flauz-beta' ? 'not-flauz' : 'flauz',
                license: 'MIT',
                type: 'module',
                engines: { vscode: '^1.140.0' },
                categories: ['Other'],
                activationEvents: options.wildcardActivation && name === 'flauz-alpha'
                        ? ['*']
                        : [`onCommand:flauz.${commandName}.thing`],
                main: './dist/extension.js',
                contributes: { commands: [{ command: `flauz.${commandName}.thing`, title: `Fixture ${commandName} Thing`, category: 'Flauz' }] },
        };
        if (options.missingMain === true && name === 'flauz-alpha') {
                delete manifest.main;
        }
        return manifest;
}

/** Boots a fixture install tree (the dist-tree angle of the installed product). */
export async function bootFixtureInstall(options: FixtureInstallOptions = {}): Promise<{ root: string; loadedVersions: Record<string, string>; cleanup: () => Promise<void> }> {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-install-'));
        const names = ['flauz-alpha', 'flauz-beta', ...(options.unknownExtension ? ['flauz-gamma'] : [])].filter(name => !(options.skipBeta === true && name === 'flauz-beta'));
        for (const name of names) {
                await fs.mkdir(path.join(root, 'extensions', name), { recursive: true });
                if (options.missingManifest === true && name === 'flauz-beta') {
                        continue; // the dir exists, the manifest does not
                }
                const manifest = fixtureInstallManifest(name, options);
                if (options.versionMismatch === true && name === 'flauz-beta') {
                        manifest.version = '9.9.9'; // the TREE is rewritten after the runtime's scan (the scan-time truth stays 0.1.0 in loadedVersions)
                }
                const text = options.unparseableManifest === true && name === 'flauz-beta'
                        ? '{ not json at all'
                        : `${JSON.stringify(manifest, null, 2)}\n`;
                await fs.writeFile(path.join(root, 'extensions', name, 'package.json'), text, 'utf-8');
        }
        // the scan-time snapshot: the versions the manifests carried when the
        // runtime scanned the tree (the versionMismatch fixture rewrites the
        // TREE after the scan -- the runtime's in-memory truth stays here)
        const loadedVersions: Record<string, string> = {};
        for (const name of names) {
                loadedVersions[name] = '0.1.0';
        }
        return { root, loadedVersions, cleanup: async () => { await fs.rm(root, { recursive: true, force: true }); } };
}

// ---------------------------------------------------------------------------
// The fixture product registry (the repo-state surfaces the census verifies against)
// ---------------------------------------------------------------------------

/** The injectable defects of a fixture product registry. */
export interface FixtureProductOptions {
        /** flauz-beta carries NO parity rows (the PP2 drift class). */
        readonly uncoveredExtension?: boolean;
        /** flauz-beta's posture row declares web-full on a main-only manifest (the PP4 drift class). */
        readonly postureDrift?: boolean;
        /** flauz-beta's SBOM component row is removed (the coverage drift class). */
        readonly sbomMissingComponent?: boolean;
        /** flauz-beta is removed from the SBOM dependency graph (the ungraphed class). */
        readonly sbomMissingDependsOn?: boolean;
        /** The parity registry is deleted (the torn contract class). */
        readonly noParity?: boolean;
        /** The SBOM is deleted (the torn inventory class). */
        readonly noSbom?: boolean;
        /** The bundle manifest is deleted (the reproducibleArtifacts red fixture). */
        readonly noBundleManifest?: boolean;
        /** The secrets allowlist is deleted (the securityPosture/secretHandling red fixture). */
        readonly noSecretsAllowlist?: boolean;
        /** The audit allowlist is deleted (the securityPosture red fixture). */
        readonly noAuditAllowlist?: boolean;
        /** A canary-shaped value planted in flauz-alpha's manifest description (the shape-projection fixture). */
        readonly canaryInManifest?: string;
        /** The commands flauz-alpha's manifest contributes (default: the one fixture command). */
        readonly alphaCommands?: readonly string[];
        /** The commands flauz-beta's manifest contributes (default: the one fixture command). */
        readonly betaCommands?: readonly string[];
}

/** The parity triad rows for one fixture extension (the W4/W5 row shapes). */
function fixtureParityRows(name: string, options: FixtureProductOptions): Record<string, unknown>[] {
        const postureClass = options.postureDrift === true && name === 'flauz-beta' ? 'web-full' : 'web-blocked';
        return [
                {
                        surface: `extensions/${name}`,
                        capability: 'extension packaging posture',
                        class: postureClass,
                        reason: `fixture posture row for ${name}`,
                        evidence: [
                                { kind: 'manifest-key', file: `extensions/${name}/package.json`, key: ['main'], value: './dist/extension.js' },
                                { kind: 'manifest-key', file: `extensions/${name}/package.json`, key: ['browser'], absent: true },
                        ],
                        recoveryPath: 'fixture recovery path',
                },
                {
                        surface: `extensions/${name}`,
                        capability: `the ${name} core (fixture)`,
                        class: 'web-full',
                        reason: 'fixture core row',
                        evidence: [{ kind: 'node-free', path: `extensions/${name}/src/api.ts` }],
                        recoveryPath: 'fixture recovery path',
                },
                {
                        surface: `extensions/${name}`,
                        capability: `the ${name} wiring (fixture)`,
                        class: 'web-blocked',
                        reason: 'fixture wiring row',
                        evidence: [{ kind: 'node-import', file: `extensions/${name}/src/extension.ts`, module: 'fs/promises' }],
                        recoveryPath: 'fixture recovery path',
                },
        ];
}

/** The fixture manifest the PRODUCT side carries (the registry's view of the packaged set). */
function fixtureProductManifest(name: string, options: FixtureProductOptions): Record<string, unknown> {
        const commandName = name.replace(/^flauz-/, '');
        const customCommands = name === 'flauz-alpha' ? options.alphaCommands : name === 'flauz-beta' ? options.betaCommands : undefined;
        const commands = customCommands !== undefined
                ? customCommands.map(command => ({ command, title: `Fixture ${command}`, category: 'Flauz' }))
                : [{ command: `flauz.${commandName}.thing`, title: `Fixture ${commandName} Thing`, category: 'Flauz' }];
        return {
                name,
                displayName: `Fixture ${name}`,
                description: options.canaryInManifest !== undefined && name === 'flauz-alpha' ? `the fixture ${name}${options.canaryInManifest}` : `the ${name} fixture extension (product registry)`,
                version: '0.1.0',
                publisher: 'flauz',
                license: 'MIT',
                type: 'module',
                engines: { vscode: '^1.140.0' },
                categories: ['Other'],
                activationEvents: [`onCommand:flauz.${commandName}.thing`],
                main: './dist/extension.js',
                contributes: { commands },
        };
}

/**
 * Boots a fixture repo-state product registry: two extension manifests + the
 * parity registry + the SBOM + the bundle manifest + the allowlists, with
 * the injectable defects.
 */
export async function bootFixtureProduct(options: FixtureProductOptions = {}): Promise<{ root: string; cleanup: () => Promise<void> }> {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-product-'));
        const names = ['flauz-alpha', 'flauz-beta'];
        for (const name of names) {
                await fs.mkdir(path.join(root, 'extensions', name, 'src'), { recursive: true });
                await fs.writeFile(path.join(root, 'extensions', name, 'package.json'), `${JSON.stringify(fixtureProductManifest(name, options), null, 2)}\n`, 'utf-8');
                await fs.writeFile(path.join(root, 'extensions', name, 'src', 'api.ts'), 'export const fixture = 1;\n', 'utf-8');
                await fs.writeFile(path.join(root, 'extensions', name, 'src', 'extension.ts'), 'export function activate(): void { /* fixture */ }\n', 'utf-8');
        }
        if (options.noParity !== true) {
                const rows: Record<string, unknown>[] = [];
                for (const name of names) {
                        if (options.uncoveredExtension === true && name === 'flauz-beta') {
                                continue; // the PP2 drift class
                        }
                        rows.push(...fixtureParityRows(name, options));
                }
                await fs.mkdir(path.join(root, 'build', 'flauz'), { recursive: true });
                await fs.writeFile(path.join(root, 'build', 'flauz', 'packaging-parity.json'), `${JSON.stringify({ version: 1, description: 'fixture parity registry', rows }, null, 2)}\n`, 'utf-8');
        }
        if (options.noSbom !== true) {
                const componentNames = names.filter(name => !(options.sbomMissingComponent === true && name === 'flauz-beta'));
                const components = componentNames.map(name => ({
                        type: 'library',
                        bomRef: `pkg:generic/flauz/${name}@0.1.0`,
                        name,
                        version: '0.1.0',
                        properties: [
                                { name: 'flauz:component-kind', value: 'flauz-extension' },
                                { name: 'flauz:artifact', value: `extensions/${name}/dist/` },
                        ],
                }));
                const dependsOn = componentNames
                        .filter(name => !(options.sbomMissingDependsOn === true && name === 'flauz-beta'))
                        .map(name => `pkg:generic/flauz/${name}@0.1.0`);
                await fs.mkdir(path.join(root, 'build', 'flauz', 'security'), { recursive: true });
                await fs.writeFile(path.join(root, 'build', 'flauz', 'security', 'flauz-sbom.json'), `${JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', components, dependencies: [{ ref: 'pkg:generic/flauz@0.1.0', dependsOn }] }, null, 2)}\n`, 'utf-8');
        }
        if (options.noBundleManifest !== true) {
                await fs.mkdir(path.join(root, 'build', 'flauz', 'security'), { recursive: true });
                await fs.writeFile(path.join(root, 'build', 'flauz', 'security', 'bundle-manifest.json'), `${JSON.stringify({ $schema: 'flauz.bundle-manifest/v1', manifestVersion: 1, status: 'PINNED', baseCommit: '0123456789abcdef0123456789abcdef01234567', bundles: { 'flauz-alpha': { version: '0.1.0' }, 'flauz-beta': { version: '0.1.0' } } }, null, 2)}\n`, 'utf-8');
        }
        if (options.noSecretsAllowlist !== true) {
                await fs.writeFile(path.join(root, 'build', 'flauz', 'security-allowlist.json'), `${JSON.stringify({ $schema: 'flauz.security-allowlist/v0', allow: [] }, null, 2)}\n`, 'utf-8');
        }
        if (options.noAuditAllowlist !== true) {
                await fs.mkdir(path.join(root, 'build', 'flauz', 'security'), { recursive: true });
                await fs.writeFile(path.join(root, 'build', 'flauz', 'security', 'audit-allowlist.json'), `${JSON.stringify({ $schema: 'flauz.audit-allowlist/v0', allow: [] }, null, 2)}\n`, 'utf-8');
        }
        return { root, cleanup: async () => { await fs.rm(root, { recursive: true, force: true }); } };
}

// ---------------------------------------------------------------------------
// The fixture workspace (the durable state the gate consults)
// ---------------------------------------------------------------------------

/** The injectable states of a fixture workspace. */
export interface FixtureWorkspaceOptions {
        /** Plant a corrupt telemetry config (the observability red fixture). */
        readonly corruptTelemetry?: boolean;
        /** Plant an ENABLED telemetry config. */
        readonly enabledTelemetry?: boolean;
        /** Plant the W3 torn-migration marker (the failureRollback red fixture). */
        readonly tornMarker?: boolean;
        /** Plant a migration stage leftover (the failureRollback red fixture). */
        readonly stageLeftover?: boolean;
        /** Plant a tasks envelope with a FUTURE format version (the upgradeCompatibility red fixture). */
        readonly futureTasks?: boolean;
        /** Plant a well-formed export dir with a MANIFEST.json (the backupRecovery green fixture). */
        readonly withExport?: boolean;
}

/** Boots a minimal-but-real fixture workspace (durable-state files with their owning schema ids). */
export async function bootFixtureWorkspace(options: FixtureWorkspaceOptions = {}): Promise<{ root: string; cleanup: () => Promise<void> }> {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-wk-'));
        await fs.mkdir(path.join(root, '.flauz'), { recursive: true });
        if (options.corruptTelemetry === true) {
                await fs.mkdir(path.join(root, '.flauz', 'telemetry'), { recursive: true });
                await fs.writeFile(path.join(root, '.flauz', 'telemetry', 'config.json'), '{ not json', 'utf-8');
        } else if (options.enabledTelemetry === true) {
                await fs.mkdir(path.join(root, '.flauz', 'telemetry'), { recursive: true });
                await fs.writeFile(path.join(root, '.flauz', 'telemetry', 'config.json'), `${JSON.stringify({ $schema: 'flauz.telemetry-config/v1', schemaVersion: 0, enabled: true, retentionDays: 30, schemaDigest: 'a'.repeat(64) }, null, 2)}\n`, 'utf-8');
        }
        if (options.tornMarker === true) {
                await fs.mkdir(path.join(root, '.flauz', 'migration'), { recursive: true });
                await fs.writeFile(path.join(root, '.flauz', 'migration', 'in-progress.json'), `${JSON.stringify({ planId: '0'.repeat(64), anchorDirName: 'export-fixture', startedAt: 1, steps: [] })}\n`, 'utf-8');
        }
        if (options.stageLeftover === true) {
                await fs.writeFile(path.join(root, '.flauz', 'tasks.json.flauz-migration.tmp'), '{}\n', 'utf-8');
        }
        if (options.futureTasks === true) {
                await fs.writeFile(path.join(root, '.flauz', 'tasks.json'), `${JSON.stringify({ $schema: 'flauz.tasks/v99', schemaVersion: 0, tasks: [] }, null, 2)}\n`, 'utf-8');
        }
        if (options.withExport === true) {
                const exportDir = path.join(root, '.flauz-exports', 'export-20260101T000000.000Z');
                await fs.mkdir(exportDir, { recursive: true });
                await fs.writeFile(path.join(exportDir, 'MANIFEST.json'), `${JSON.stringify({ $schema: 'flauz.backup-manifest/v1', schemaVersion: 0, formatVersion: 1, createdAt: 1, exportDirName: 'export-20260101T000000.000Z', surfaces: [], files: [], fileCount: 0, totalBytes: 0 }, null, 2)}\n`, 'utf-8');
        }
        return { root, cleanup: async () => { await fs.rm(root, { recursive: true, force: true }); } };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Reads every file under a directory (recursive) as { path, text } -- the canary byte-scan vehicle. */
export async function readAllFiles(dir: string): Promise<{ path: string; text: string }[]> {
        const out: { path: string; text: string }[] = [];
        let entries;
        try {
                entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
                return out;
        }
        for (const entry of entries) {
                const target = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                        out.push(...await readAllFiles(target));
                } else if (entry.isFile()) {
                        out.push({ path: target, text: await fs.readFile(target, 'utf-8') });
                }
        }
        return out;
}

/** The fixture versions block (the tests' deterministic VersionsInfo). */
export function fixtureVersions(): { productVersion: string; productName: string; extensions: { id: string; version: string }[] } {
        return {
                productVersion: '0.1.0',
                productName: 'Flauz',
                extensions: [{ id: 'flauz.flauz-production', version: '0.1.0' }, { id: 'flauz.flauz-release', version: '0.1.0' }],
        };
}

/** Assembles a canary-shaped token from fragments at runtime (the no-literal law; never a complete secret in source). */
export function canaryToken(kind: 'github' | 'openai' | 'aws' | 'bearer'): string {
        switch (kind) {
                case 'github': return `ghp_${'Frag'.repeat(10)}Xmp1`; // 20+ chars, ghp_ prefix
                case 'openai': return `sk-ant-${'frag'.repeat(8)}Zq2`; // sk-ant- prefix, 16+ chars
                case 'aws': return `AKIA${'QWER'.repeat(4)}`; // AKIA + exactly 16 chars (the pattern's word boundary)
                case 'bearer': return `Bearer ${'tok'.repeat(10)}AbCd`; // Bearer + 16+ chars
        }
}
