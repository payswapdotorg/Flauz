/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The installed-product census (A-PROD-005-W1 -- the production-readiness
 * verification plane's first surface): verifies the product the RUNTIME
 * actually loaded against the repo-state product registry, through the W5
 * product-root ports (the designed seam).
 *
 * THE FIVE CHECK CLASSES (the typed verdict table, green/tampered/torn per
 * class -- the W2/W5 grammar):
 *
 *   installed -- the runtime set + the dist-tree manifests: every
 *                runtime-listed flauz extension's on-disk manifest present +
 *                parseable (missing/unparseable = TORN -- an incomplete
 *                install) and CONSISTENT with what the runtime loaded (the
 *                manifest's declared version or id disagreeing with the
 *                runtime-reported one = TAMPERED -- this wave's
 *                runtime-vs-disk consistency check);
 *   laws      -- the built-in id law (publisher 'flauz', the manifest name
 *                matching the runtime id) + the entrypoint law (main or
 *                browser) + the activation-lint mirror R1-R3 (the W5 mirror,
 *                contract-duplicated) over every installed manifest -- a
 *                violation is TAMPERED;
 *   presence  -- the installed set vs the registry expectations, both
 *                directions: an expected extension ABSENT from the installed
 *                set is TORN (incomplete install); an installed flauz
 *                extension the registries do not name is TAMPERED (an
 *                unknown extension in the product -- the typed verdict,
 *                disclosed with the exact ids);
 *   parity    -- the packaging-parity contract over the INSTALLED set: every
 *                installed extension carries rows (PP2 -- an unclassified
 *                surface is a violation), every parity surface has an
 *                installed extension (torn -- incomplete install), and every
 *                posture row's class re-derives from the installed manifest
 *                (PP4 -- drift is tampered);
 *   sbom      -- the SBOM component coverage over the INSTALLED set: every
 *                installed extension has a component row, every extension
 *                component has an installed extension (torn), and the
 *                dependency graph covers every component (tampered when it
 *                does not).
 *
 * THE DEGRADATION LAW: where the runtime surface is ABSENT (no installed
 * product -- the worker sandbox's honest state) the census DEGRADES TYPED
 * (the result carries the degradation, ok=false, the record still persists
 * with the honest state) -- never a silent green. An installed product that
 * enumerated zero flauz extensions degrades typed the same way.
 *
 * THE RECORD: `.flauz/production/census-<stamp>.json`
 * (flauz.production-census/v1) -- surface SHAPES only (ids, versions,
 * verdicts, counts, paths), swept fail-closed before write, banked
 * census-visible (taskId 'flauz-production'), the watermark re-synced.
 */

import {
        type Clock,
        type ProductionFsPort,
        type VersionsInfo,
        CENSUS_RECORD_PREFIX,
        CENSUS_RECORD_SCHEMA_ID,
        EXTENSION_ID,
        PRODUCTION_DIR,
        joinPath,
        serializeArtifact,
        PRODUCT_EXTENSIONS_DIR,
} from './api.ts';
import { readProductState, activationLintReasons, expectedExtensionNames, postureDriftReasons, type ProductState } from './productState.ts';
import { readInstalledProduct, type InstalledProduct, type InstalledProductPort } from './installedProduct.ts';
import { sweepArtifact } from './privacy.ts';
import { bankLedgerRowFor, type BankingOutcome } from './banking.ts';
import { toIsoStamp } from './format.ts';

// ---------------------------------------------------------------------------
// The check classes
// ---------------------------------------------------------------------------

/** The census check classes (the verdict table's rows). */
export type CensusCheckClass = 'installed' | 'laws' | 'presence' | 'parity' | 'sbom';

/** The typed verdict vocabulary (the W2/W5 grammar). */
export type CensusVerdict = 'green' | 'tampered' | 'torn';

/** One census check outcome. */
export interface CensusCheck {
        readonly check: CensusCheckClass;
        readonly verdict: CensusVerdict;
        readonly reasons: readonly string[];
        readonly counts: Record<string, unknown>;
}

function worse(a: CensusVerdict, b: CensusVerdict): CensusVerdict {
        if (a === 'tampered' || b === 'tampered') {
                return 'tampered';
        }
        if (a === 'torn' || b === 'torn') {
                return 'torn';
        }
        return 'green';
}

/** The installed name of a runtime id (`flauz.flauz-release` -> `flauz-release`). */
function installedNameOf(id: string): string {
        return id.startsWith('flauz.') ? id.slice('flauz.'.length) : id;
}

// --- check 1: the runtime set + the dist-tree manifests ---

function checkInstalled(installed: InstalledProduct): CensusCheck {
        const reasons: string[] = [];
        let verdict: CensusVerdict = 'green';
        for (const extension of installed.extensions) {
                if (!extension.manifestPresent) {
                        verdict = worse(verdict, 'torn');
                        reasons.push(`${extension.id}: the on-disk manifest ${joinPath(extension.extensionPath, 'package.json')} is missing (the runtime loaded the extension but the dist tree does not carry its manifest -- an incomplete install)`);
                        continue;
                }
                if (extension.parseError !== undefined) {
                        verdict = worse(verdict, 'torn');
                        reasons.push(`${extension.id}: the on-disk manifest does not parse (${extension.parseError}) -- the dist tree is structurally incomplete`);
                        continue;
                }
                if (extension.idMismatch === true) {
                        verdict = worse(verdict, 'tampered');
                        reasons.push(`${extension.id}: the on-disk manifest's id (publisher ${JSON.stringify(extension.publisher)}) disagrees with the runtime-loaded id -- the dist tree no longer matches what the runtime loaded`);
                }
                if (extension.versionMismatch === true) {
                        verdict = worse(verdict, 'tampered');
                        reasons.push(`${extension.id}: the runtime loaded version ${JSON.stringify(extension.runtimeVersion)} but the on-disk manifest declares ${JSON.stringify(extension.manifestVersion)} -- the dist tree no longer matches what the runtime loaded`);
                }
        }
        return {
                check: 'installed',
                verdict,
                reasons,
                counts: {
                        runtimeExtensionCount: installed.extensions.length,
                        manifestPresentCount: installed.extensions.filter(extension => extension.manifestPresent).length,
                        parseCleanCount: installed.extensions.filter(extension => extension.manifestPresent && extension.parseError === undefined).length,
                        consistentCount: installed.extensions.filter(extension => extension.manifestPresent && extension.parseError === undefined && extension.idMismatch !== true && extension.versionMismatch !== true).length,
                },
        };
}

// --- check 2: the id/entrypoint laws + the activation-lint mirror ---

function checkLaws(installed: InstalledProduct): CensusCheck {
        const reasons: string[] = [];
        let verdict: CensusVerdict = 'green';
        for (const extension of installed.extensions) {
                if (!extension.manifestPresent || extension.parseError !== undefined) {
                        continue; // the installed class owns those verdicts
                }
                // the W5 activation-lint mirror over the installed manifest (the
                // summary is adapted to the ExtensionManifestSummary shape the
                // contract-duplicated mirror consumes; the id comes from the runtime)
                const name = installedNameOf(extension.id);
                const summary: import('./productState.ts').ExtensionManifestSummary = {
                        extensionDir: joinPath(PRODUCT_EXTENSIONS_DIR, name),
                        manifestPath: joinPath(extension.extensionPath, 'package.json'),
                        name,
                        manifestPresent: true,
                        publisher: extension.publisher,
                        main: extension.main,
                        browser: extension.browser,
                        activationEvents: extension.activationEvents,
                        commands: extension.commands,
                        ...(extension.id !== undefined ? { id: extension.id } : {}),
                };
                for (const reason of activationLintReasons(summary)) {
                        verdict = worse(verdict, 'tampered');
                        reasons.push(`${extension.id}: ${reason}`);
                }
        }
        return {
                check: 'laws',
                verdict,
                reasons,
                counts: {
                        checkedCount: installed.extensions.filter(extension => extension.manifestPresent && extension.parseError === undefined).length,
                        violationCount: reasons.length,
                },
        };
}

// --- check 3: the installed set vs the registry expectations, both directions ---

function checkPresence(installed: InstalledProduct, product: ProductState): CensusCheck {
        const reasons: string[] = [];
        let verdict: CensusVerdict = 'green';
        const installedNames = new Set(installed.extensions.map(extension => installedNameOf(extension.id)));
        const expected = expectedExtensionNames(product);
        for (const name of expected) {
                if (!installedNames.has(name)) {
                        verdict = worse(verdict, 'torn');
                        reasons.push(`extensions/${name} is expected by the product registry (parity surfaces + SBOM components) but the runtime did not load it -- an incomplete install`);
                }
        }
        for (const name of [...installedNames].sort()) {
                if (!expected.includes(name)) {
                        verdict = worse(verdict, 'tampered');
                        reasons.push(`extensions/${name} is loaded by the runtime but named by NO registry surface (neither the parity rows nor the SBOM components) -- an unknown extension in the product, disclosed`);
                }
        }
        return {
                check: 'presence',
                verdict,
                reasons,
                counts: {
                        expectedCount: expected.length,
                        installedCount: installedNames.size,
                        missingCount: expected.filter(name => !installedNames.has(name)).length,
                        unexpectedCount: [...installedNames].filter(name => !expected.includes(name)).length,
                },
        };
}

// --- check 4: the parity contract over the installed set ---

function checkParity(installed: InstalledProduct, product: ProductState): CensusCheck {
        const reasons: string[] = [];
        let verdict: CensusVerdict = 'green';
        if (!product.parity.present) {
                return {
                        check: 'parity',
                        verdict: 'torn',
                        reasons: ['build/flauz/packaging-parity.json is absent from the product state -- the packaging-parity machine contract itself is incomplete'],
                        counts: { rowCount: 0 },
                };
        }
        if (product.parity.parseError !== undefined) {
                return {
                        check: 'parity',
                        verdict: 'torn',
                        reasons: [`build/flauz/packaging-parity.json does not parse (${product.parity.parseError}) -- the machine contract is structurally broken`],
                        counts: { rowCount: 0 },
                };
        }
        const installedDirs = new Set(installed.extensions.map(extension => joinPath(PRODUCT_EXTENSIONS_DIR, installedNameOf(extension.id))));
        for (const extension of installed.extensions) {
                const dir = joinPath(PRODUCT_EXTENSIONS_DIR, installedNameOf(extension.id));
                if (!product.parity.extensionSurfaces.includes(dir)) {
                        verdict = worse(verdict, 'tampered');
                        reasons.push(`${dir} is installed but carries no packaging-parity rows (an unclassified surface is a violation -- PP2)`);
                }
        }
        for (const surface of product.parity.extensionSurfaces) {
                if (!installedDirs.has(surface)) {
                        verdict = worse(verdict, 'torn');
                        reasons.push(`the parity registry covers ${surface} but the runtime did not load it (incomplete install or vanished surface -- PP2 drift)`);
                }
        }
        // PP4 posture re-derivation over the installed manifests
        for (const extension of installed.extensions) {
                if (!extension.manifestPresent || extension.parseError !== undefined) {
                        continue;
                }
                const dir = joinPath(PRODUCT_EXTENSIONS_DIR, installedNameOf(extension.id));
                const postureRows = product.parity.rows.filter(row => row.surface === dir && row.capability === 'extension packaging posture');
                const drifts = postureDriftReasons(
                        { extensionDir: dir, manifestPath: joinPath(dir, 'package.json'), name: installedNameOf(extension.id), manifestPresent: true, activationEvents: extension.activationEvents, commands: extension.commands, main: extension.main, browser: extension.browser },
                        postureRows,
                );
                for (const drift of drifts) {
                        verdict = worse(verdict, 'tampered');
                        reasons.push(drift);
                }
        }
        return {
                check: 'parity',
                verdict,
                reasons,
                counts: {
                        rowCount: product.parity.rowCount,
                        extensionSurfaceCount: product.parity.extensionSurfaces.length,
                        installedSurfaceCount: installedDirs.size,
                },
        };
}

// --- check 5: the SBOM coverage over the installed set ---

function checkSbom(installed: InstalledProduct, product: ProductState): CensusCheck {
        const reasons: string[] = [];
        let verdict: CensusVerdict = 'green';
        if (!product.sbom.present) {
                return {
                        check: 'sbom',
                        verdict: 'torn',
                        reasons: ['build/flauz/security/flauz-sbom.json is absent from the product state -- the component inventory itself is incomplete'],
                        counts: { componentCount: 0 },
                };
        }
        if (product.sbom.parseError !== undefined) {
                return {
                        check: 'sbom',
                        verdict: 'torn',
                        reasons: [`build/flauz/security/flauz-sbom.json does not parse (${product.sbom.parseError}) -- the component inventory is structurally broken`],
                        counts: { componentCount: 0 },
                };
        }
        const installedNames = new Set(installed.extensions.map(extension => installedNameOf(extension.id)));
        const componentNames = new Set(product.sbom.extensionComponents.map(component => component.name));
        for (const extension of installed.extensions) {
                const name = installedNameOf(extension.id);
                if (!componentNames.has(name)) {
                        verdict = worse(verdict, 'tampered');
                        reasons.push(`${name} is installed but has no SBOM component row (an untracked component -- the inventory must cover every installed extension)`);
                }
        }
        for (const component of product.sbom.extensionComponents) {
                if (!installedNames.has(component.name)) {
                        verdict = worse(verdict, 'torn');
                        reasons.push(`the SBOM tracks component '${component.name}' but the runtime did not load it (incomplete install or vanished surface)`);
                }
                if (!product.sbom.dependsOn.includes(component.bomRef)) {
                        verdict = worse(verdict, 'tampered');
                        reasons.push(`the SBOM component '${component.name}' is absent from the dependency graph's dependsOn (an ungraphed component)`);
                }
        }
        for (const ref of product.sbom.dependsOn) {
                if (!product.sbom.extensionComponents.some(component => component.bomRef === ref)) {
                        verdict = worse(verdict, 'tampered');
                        reasons.push(`the dependency graph's dependsOn carries '${ref}' with no matching component row (a dangling dependency)`);
                }
        }
        return {
                check: 'sbom',
                verdict,
                reasons,
                counts: {
                        componentCount: product.sbom.componentCount,
                        extensionComponentCount: product.sbom.extensionComponents.length,
                        installedComponentCount: [...installedNames].filter(name => componentNames.has(name)).length,
                },
        };
}

/** Runs all five census checks over the installed product + the registry state. */
export function censusChecks(installed: InstalledProduct, product: ProductState): readonly CensusCheck[] {
        return [checkInstalled(installed), checkLaws(installed), checkPresence(installed, product), checkParity(installed, product), checkSbom(installed, product)];
}

// ---------------------------------------------------------------------------
// The whole census
// ---------------------------------------------------------------------------

/** The typed degradation kinds (the honest-absence vocabulary). */
export type CensusDegradation =
        | { readonly kind: 'no-installed-product'; readonly reason: string }
        | { readonly kind: 'empty-installed-product'; readonly reason: string };

/** The whole census result (the `flauz.production.census` surface). */
export interface InstalledProductCensusResult {
        readonly ok: boolean;
        readonly createdAt: number;
        readonly productRoot: string;
        /** undefined when the census degraded (the runtime surface absent/empty). */
        readonly installed: InstalledProduct | undefined;
        readonly degradation: CensusDegradation | undefined;
        readonly checks: readonly CensusCheck[];
}

/** Deps of the census. */
export interface CensusDeps {
        readonly root: string;
        readonly fs: ProductionFsPort;
        readonly clock: Clock;
        /** The repo-state product root (the caller's typed refusal owns the absent case). */
        readonly productRoot: string;
        /** The runtime installed-product port (the seam a real install drives). */
        readonly installedProduct: InstalledProductPort;
}

/**
 * Runs the installed-product census end-to-end. Reads the product registry
 * through the W5 ports + the installed product through the runtime port;
 * never persists the record (the caller owns persistence).
 */
export async function runCensus(deps: CensusDeps): Promise<InstalledProductCensusResult> {
        const createdAt = deps.clock();
        const product = await readProductState(deps.productRoot, deps.fs);
        if (product === undefined) {
                // the caller owns the typed refusal; defensively surfaced here as a torn installed class
                return {
                        ok: false,
                        createdAt,
                        productRoot: deps.productRoot,
                        installed: undefined,
                        degradation: { kind: 'no-installed-product', reason: `${deps.productRoot} carries no extensions/ directory -- not a repo-state product registry` },
                        checks: [{ check: 'installed', verdict: 'torn', reasons: [`${deps.productRoot} carries no extensions/ directory -- not a repo-state product registry`], counts: {} }],
                };
        }
        const installed = await readInstalledProduct(deps.installedProduct, deps.fs);
        if (installed === undefined) {
                return {
                        ok: false,
                        createdAt,
                        productRoot: deps.productRoot,
                        installed: undefined,
                        degradation: {
                                kind: 'no-installed-product',
                                reason: 'the runtime installed-product surface is ABSENT (no installed product was enumerated -- the worker sandbox\'s honest state; the port is the seam a real install drives) -- the census degrades typed, never silently green',
                        },
                        checks: [],
                };
        }
        if (installed.extensions.length === 0) {
                return {
                        ok: false,
                        createdAt,
                        productRoot: deps.productRoot,
                        installed,
                        degradation: {
                                kind: 'empty-installed-product',
                                reason: 'the runtime enumerated ZERO flauz extensions (an installed product with no flauz built-ins is not a Flauz product state) -- the census degrades typed, never silently green',
                        },
                        checks: [],
                };
        }
        const checks = censusChecks(installed, product);
        return {
                ok: checks.every(check => check.verdict === 'green'),
                createdAt,
                productRoot: deps.productRoot,
                installed,
                degradation: undefined,
                checks,
        };
}

// ---------------------------------------------------------------------------
// The persisted record
// ---------------------------------------------------------------------------

/** The census record body (`.flauz/production/census-<stamp>.json`). */
export interface InstalledProductCensusRecord {
        readonly $schema: typeof CENSUS_RECORD_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly createdAt: number;
        readonly productName: string;
        readonly productVersion: string;
        readonly extensionId: typeof EXTENSION_ID;
        readonly extensionVersion: string;
        readonly workspaceRoot: string;
        readonly productRoot: string;
        readonly commandLine: 'flauz.production.census';
        readonly ok: boolean;
        readonly degraded: boolean;
        readonly degradation?: { readonly kind: string; readonly reason: string };
        readonly installedExtensionIds: readonly string[];
        readonly checks: readonly CensusCheck[];
        readonly privacyLaw: string;
}

/** The filename-safe stamp of a census record (the export-stamp convention). */
export function censusRecordStamp(epochMs: number): string {
        return toIsoStamp(epochMs).replaceAll(':', '');
}

/** The persisted outcome. */
export interface PersistedCensus {
        readonly recordPath: string;
        readonly record: InstalledProductCensusRecord;
        readonly banking: BankingOutcome;
}

/**
 * Persists the census record workspace-locally + banks it census-visible:
 * sweeps the record (fail-closed), writes
 * `.flauz/production/census-<stamp>.json` (DL-9 serialization), then appends
 * the evidence-ledger note row (uri = the record path, sha256 = the artifact
 * bytes) with the watermark re-sync.
 */
export async function persistCensus(deps: { root: string; fs: ProductionFsPort; clock: Clock }, versions: VersionsInfo, result: InstalledProductCensusResult): Promise<PersistedCensus> {
        const record: InstalledProductCensusRecord = {
                $schema: CENSUS_RECORD_SCHEMA_ID,
                schemaVersion: 0,
                createdAt: result.createdAt,
                productName: versions.productName,
                productVersion: versions.productVersion,
                extensionId: EXTENSION_ID,
                extensionVersion: versions.extensions.find(extension => extension.id === EXTENSION_ID)?.version ?? 'unknown',
                workspaceRoot: deps.root,
                productRoot: result.productRoot,
                commandLine: 'flauz.production.census',
                ok: result.ok,
                degraded: result.degradation !== undefined,
                ...(result.degradation !== undefined ? { degradation: { kind: result.degradation.kind, reason: result.degradation.reason } } : {}),
                installedExtensionIds: result.installed !== undefined ? result.installed.extensions.map(extension => extension.id) : [],
                checks: result.checks,
                privacyLaw: 'METADATA-ONLY: surface shapes (paths, versions, checksums, verdicts, counts, capability ids) -- never contents; swept for secret-shaped values before write (fail-closed, the W1/W5 posture).',
        };
        sweepArtifact(record, 'census-record');
        const recordText = serializeArtifact(record);
        const dirName = `${CENSUS_RECORD_PREFIX}${censusRecordStamp(result.createdAt)}`;
        const recordPath = joinPath(deps.root, PRODUCTION_DIR, `${dirName}.json`);
        await deps.fs.mkdir(joinPath(deps.root, PRODUCTION_DIR));
        await deps.fs.writeFile(recordPath, recordText);
        const banking = await bankLedgerRowFor({ root: deps.root, fs: deps.fs, clock: deps.clock }, recordText, joinPath(PRODUCTION_DIR, `${dirName}.json`));
        return { recordPath, record, banking };
}

/** Renders the census (the `flauz.production.census` channel surface). */
export function renderCensus(result: InstalledProductCensusResult): readonly string[] {
        const lines: string[] = [];
        lines.push(`flauz.production.census: the installed-product census -- verdict ${result.ok ? 'GREEN (the installed product verifies against the registry)' : 'REFUSED (the installed product does not verify)'}`);
        lines.push(`  product registry: ${result.productRoot} (the repo-state product, read through the W5 product-root ports -- the designed seam)`);
        if (result.degradation !== undefined) {
                lines.push(`  DEGRADED (${result.degradation.kind}): ${result.degradation.reason}`);
                lines.push('  the census degrades typed, never silently green -- the record persists with the honest state');
                return lines;
        }
        lines.push(`  installed product: ${String(result.installed?.extensions.length ?? 0)} runtime-loaded flauz extension(s) (the runtime port enumeration + the dist-tree manifests)`);
        lines.push('  check verdicts:');
        for (const check of result.checks) {
                const summary = check.reasons.length > 0 ? ` -- ${check.reasons.join('; ')}` : '';
                const counts = Object.entries(check.counts).map(([key, value]) => `${key}=${String(value)}`).join(' ');
                lines.push(`    ${check.verdict.padEnd(8)} ${check.check.padEnd(10)}${counts.length > 0 ? ` (${counts})` : ''}${summary}`);
        }
        return lines;
}
