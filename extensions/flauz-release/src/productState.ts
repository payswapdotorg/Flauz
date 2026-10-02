/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The repo-state product verification core (A-PROD-004-W5 -- the wave's own
 * machinery): the install verification's three PRODUCT check classes.
 *
 * THE PRODUCT-STATE LAW (this wave's evidence law): the install verification
 * runs against the REPO-STATE PRODUCT -- the `extensions/flauz-*` manifests
 * (the packaged extension set), `build/flauz/packaging-parity.json` (the
 * TL1-005 machine contract: rows vs manifests) and
 * `build/flauz/security/flauz-sbom.json` (the security-runtime-gate component
 * inventory). A workspace that carries none of these is not a product state
 * and the verification refuses typed (FLAUZ_RELEASE_NO_PRODUCT_STATE) -- the
 * runtime-installed-product angle is A-PROD-005's production-readiness lane,
 * reported as residue, never improvised here.
 *
 * THE THREE CHECK CLASSES (the typed verdict vocabulary green/tampered/torn,
 * the W2 grammar):
 *
 *   extensions -- the extension census: every packaged extension present
 *                 (each surface the registries name has a live manifest --
 *                 a missing/unparseable manifest is a TORN install) and
 *                 activation-lint clean (the command-only activation rules
 *                 mirrored from build/flauz/scripts/activation-lint.mjs:
 *                 R1 no '*', R2 the whitelisted event shapes, R3
 *                 onStartupFinished only for the bridge + workspace
 *                 extensions, plus the built-in id law -- a violation is
 *                 TAMPERED);
 *   parity     -- the packaging-parity contract (rows vs manifests, the
 *                 PP2/PP4 semantics re-derived): every live flauz-* manifest
 *                 carries rows, no row cites a vanished surface (torn -- the
 *                 incomplete-install reading), and every posture row's class
 *                 re-derives from the live manifest (main-only means
 *                 web-blocked -- a drift is tampered);
 *   sbom       -- the SBOM component coverage: every live flauz-* extension
 *                 has a component row, every extension component has a live
 *                 manifest (torn), and the dependency graph covers every
 *                 component (tampered when it does not).
 *
 * Every surface enumerated here is a SHAPE (paths, versions, ids, classes) --
 * the metadata law; never contents.
 */

import {
        PRODUCT_EXTENSIONS_DIR,
        PRODUCT_PARITY_REGISTRY_PATH,
        PRODUCT_SBOM_PATH,
        isPlainObject,
        joinPath,
        type ReleaseFsPort,
} from './api.ts';

// ---------------------------------------------------------------------------
// The product-state reader
// ---------------------------------------------------------------------------

/** One live extension manifest of the product state (a shape summary, never contents). */
export interface ExtensionManifestSummary {
        /** The extension directory, product-root-relative (e.g. `extensions/flauz-release`). */
        readonly extensionDir: string;
        /** The manifest path, product-root-relative. */
        readonly manifestPath: string;
        /** The directory name (the packaging identity the registries key on). */
        readonly name: string;
        readonly manifestPresent: boolean;
        readonly parseError?: string;
        readonly publisher?: string;
        readonly version?: string;
        readonly main?: string;
        readonly browser?: string;
        readonly activationEvents: readonly string[];
        readonly enginesVscode?: string;
        /** The derived extension id (`<publisher>.<name>` when both resolve). */
        readonly id?: string;
}

/** The parity registry summary (the rows' shape, never the full reason text). */
export interface ParityRegistrySummary {
        readonly present: boolean;
        readonly parseError?: string;
        readonly rowCount: number;
        readonly rows: readonly { readonly surface: string; readonly capability: string; readonly class: string }[];
        /** The distinct `extensions/flauz-*` surfaces the rows cover. */
        readonly extensionSurfaces: readonly string[];
}

/** The SBOM summary (the extension component inventory + the dependency graph). */
export interface SbomSummary {
        readonly present: boolean;
        readonly parseError?: string;
        readonly componentCount: number;
        /** The extension-kind components (the packaged extension set the SBOM tracks). */
        readonly extensionComponents: readonly { readonly name: string; readonly version: string; readonly bomRef: string; readonly artifact?: string }[];
        readonly dependsOn: readonly string[];
}

/** The whole product state, as the verification consumes it. */
export interface ProductState {
        readonly productRoot: string;
        readonly extensions: readonly ExtensionManifestSummary[];
        readonly parity: ParityRegistrySummary;
        readonly sbom: SbomSummary;
}

/**
 * The product-state signature probe: a root carrying the parity registry is
 * repo-state-product-shaped (the registry is the machine contract that pins
 * the packaged surface set; the wiring layer resolves the workspace root's
 * product state through this probe).
 */
export async function isProductRoot(root: string, fs: ReleaseFsPort): Promise<boolean> {
        const text = await fs.readFileUtf8(joinPath(root, PRODUCT_PARITY_REGISTRY_PATH));
        return text !== undefined;
}

/**
 * Reads the product state from a repo-shaped root. Returns undefined when
 * the root carries no `extensions/` directory (not a product state -- the
 * caller's typed refusal). Absent registry/SBOM are reported INSIDE the
 * summaries (the check classes carry the torn verdicts, the reader never
 * guesses).
 */
export async function readProductState(productRoot: string, fs: ReleaseFsPort): Promise<ProductState | undefined> {
        const entries = await fs.readdir(joinPath(productRoot, PRODUCT_EXTENSIONS_DIR));
        if (entries === undefined) {
                return undefined;
        }
        const flauzEntries = [...entries].filter(name => /^flauz-[a-z0-9-]+$/.test(name)).sort();

        const extensions: ExtensionManifestSummary[] = [];
        for (const name of flauzEntries) {
                const extensionDir = joinPath(PRODUCT_EXTENSIONS_DIR, name);
                const manifestPath = joinPath(extensionDir, 'package.json');
                const text = await fs.readFileUtf8(joinPath(productRoot, manifestPath));
                if (text === undefined) {
                        extensions.push({ extensionDir, manifestPath, name, manifestPresent: false, activationEvents: [] });
                        continue;
                }
                let parsed: unknown;
                try {
                        parsed = JSON.parse(text);
                } catch (err) {
                        extensions.push({ extensionDir, manifestPath, name, manifestPresent: true, parseError: (err as Error).message, activationEvents: [] });
                        continue;
                }
                if (!isPlainObject(parsed)) {
                        extensions.push({ extensionDir, manifestPath, name, manifestPresent: true, parseError: 'the manifest is not a JSON object', activationEvents: [] });
                        continue;
                }
                const publisher = typeof parsed.publisher === 'string' ? parsed.publisher : undefined;
                const version = typeof parsed.version === 'string' ? parsed.version : undefined;
                const main = typeof parsed.main === 'string' ? parsed.main : undefined;
                const browser = typeof parsed.browser === 'string' ? parsed.browser : undefined;
                const activationEvents = Array.isArray(parsed.activationEvents) ? parsed.activationEvents.filter((event): event is string => typeof event === 'string') : [];
                const engines = isPlainObject(parsed.engines) && typeof (parsed.engines as Record<string, unknown>).vscode === 'string' ? (parsed.engines as Record<string, unknown>).vscode as string : undefined;
                extensions.push({
                        extensionDir,
                        manifestPath,
                        name,
                        manifestPresent: true,
                        publisher,
                        version,
                        main,
                        browser,
                        activationEvents,
                        enginesVscode: engines,
                        ...(publisher !== undefined ? { id: `${publisher}.${parsed.name === name ? name : String(parsed.name)}` } : {}),
                });
        }

        // --- the parity registry (absent surfaces as torn data, never guesses) ---
        const parityText = await fs.readFileUtf8(joinPath(productRoot, PRODUCT_PARITY_REGISTRY_PATH));
        let parity: ParityRegistrySummary;
        if (parityText === undefined) {
                parity = { present: false, rowCount: 0, rows: [], extensionSurfaces: [] };
        } else {
                let parsed: unknown;
                let parseError: string | undefined;
                try {
                        parsed = JSON.parse(parityText);
                } catch (err) {
                        parseError = (err as Error).message;
                }
                if (parseError === undefined && (!isPlainObject(parsed) || !Array.isArray((parsed as Record<string, unknown>).rows))) {
                        parseError = 'the registry does not carry a rows[] array (not a packaging-parity registry body)';
                }
                const rows: { surface: string; capability: string; class: string }[] = [];
                if (parseError === undefined && Array.isArray((parsed as Record<string, unknown>).rows)) {
                        for (const row of (parsed as Record<string, unknown>).rows as unknown[]) {
                                if (isPlainObject(row) && typeof row.surface === 'string' && typeof row.capability === 'string' && typeof row.class === 'string') {
                                        rows.push({ surface: row.surface, capability: row.capability, class: row.class });
                                }
                        }
                }
                parity = {
                        present: true,
                        ...(parseError !== undefined ? { parseError } : {}),
                        rowCount: parseError !== undefined ? 0 : rows.length,
                        rows: parseError !== undefined ? [] : rows,
                        extensionSurfaces: [...new Set(rows.map(row => row.surface).filter(surface => surface.startsWith(`${PRODUCT_EXTENSIONS_DIR}/`)))].sort(),
                };
        }

        // --- the SBOM (absent surfaces as torn data, never guesses) ---
        const sbomText = await fs.readFileUtf8(joinPath(productRoot, PRODUCT_SBOM_PATH));
        let sbom: SbomSummary;
        if (sbomText === undefined) {
                sbom = { present: false, componentCount: 0, extensionComponents: [], dependsOn: [] };
        } else {
                let parsed: unknown;
                let parseError: string | undefined;
                try {
                        parsed = JSON.parse(sbomText);
                } catch (err) {
                        parseError = (err as Error).message;
                }
                if (parseError === undefined && !isPlainObject(parsed)) {
                        parseError = 'the SBOM is not a JSON object';
                }
                const extensionComponents: { name: string; version: string; bomRef: string; artifact?: string }[] = [];
                let dependsOn: string[] = [];
                let componentCount = 0;
                if (parseError === undefined && isPlainObject(parsed)) {
                        const components = Array.isArray(parsed.components) ? parsed.components : [];
                        componentCount = components.length;
                        for (const component of components) {
                                if (!isPlainObject(component) || typeof component.name !== 'string') {
                                        continue;
                                }
                                const kind = Array.isArray(component.properties)
                                        ? (component.properties as unknown[]).filter((property): property is Record<string, unknown> => isPlainObject(property) && property.name === 'flauz:component-kind' && typeof property.value === 'string').map(property => property.value as string)[0]
                                        : undefined;
                                if (kind !== 'flauz-extension') {
                                        continue;
                                }
                                const artifact = Array.isArray(component.properties)
                                        ? (component.properties as unknown[]).filter((property): property is Record<string, unknown> => isPlainObject(property) && property.name === 'flauz:artifact' && typeof property.value === 'string').map(property => property.value as string)[0]
                                        : undefined;
                                extensionComponents.push({
                                        name: component.name,
                                        version: typeof component.version === 'string' ? component.version : '',
                                        bomRef: typeof component.bomRef === 'string' ? component.bomRef : typeof component.purl === 'string' ? component.purl : component.name,
                                        ...(artifact !== undefined ? { artifact } : {}),
                                });
                        }
                        if (Array.isArray(parsed.dependencies)) {
                                for (const dependency of parsed.dependencies) {
                                        if (isPlainObject(dependency) && Array.isArray(dependency.dependsOn)) {
                                                dependsOn = (dependency.dependsOn as unknown[]).filter((ref): ref is string => typeof ref === 'string');
                                        }
                                }
                        }
                }
                sbom = {
                        present: true,
                        ...(parseError !== undefined ? { parseError } : {}),
                        componentCount: parseError !== undefined ? 0 : componentCount,
                        extensionComponents: parseError !== undefined ? [] : extensionComponents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
                        dependsOn: parseError !== undefined ? [] : dependsOn,
                };
        }

        return { productRoot, extensions, parity, sbom };
}

// ---------------------------------------------------------------------------
// The check classes
// ---------------------------------------------------------------------------

/** The product check classes (the install verification's first three). */
export type ProductCheckClass = 'extensions' | 'parity' | 'sbom';

/** The typed verdict vocabulary (the W2 grammar). */
export type ProductVerdict = 'green' | 'tampered' | 'torn';

/** One product check outcome. */
export interface ProductCheck {
        readonly check: ProductCheckClass;
        readonly verdict: ProductVerdict;
        readonly reasons: readonly string[];
        readonly counts: Record<string, unknown>;
}

function worse(a: ProductVerdict, b: ProductVerdict): ProductVerdict {
        if (a === 'tampered' || b === 'tampered') {
                return 'tampered';
        }
        if (a === 'torn' || b === 'torn') {
                return 'torn';
        }
        return 'green';
}

// --- the activation-lint mirror (the command-only activation rules,
//     contract-duplicated from build/flauz/scripts/activation-lint.mjs R1-R3) ---

/** R3's allowed onStartupFinished ids (the bridge + workspace budget). */
const STARTUP_ALLOWED_IDS = new Set(['flauz.flauz-agent', 'flauz.flauz-workspace']);

/** R2's whitelisted event shapes (the flauz command/view/task-type/provider families). */
const EVENT_SHAPES: readonly RegExp[] = [
        /^onCommand:flauz\.[A-Za-z0-9._-]+\*?$/,
        /^onView:flauz\.[A-Za-z0-9._-]+$/,
        /^onTaskType:flauz\.[A-Za-z0-9._-]+$/,
        /^onLanguageModelChatProvider:[A-Za-z0-9._-]+$/,
];

/**
 * The activation-lint mirror over one manifest summary: returns the
 * violation reasons (empty = clean). R1: '*' forbidden; R2: whitelisted
 * event shapes only; R3: onStartupFinished only for the allowed ids; plus
 * the built-in id law (publisher flauz, the manifest name matching its
 * directory) and the entrypoint law (a command-activated manifest must
 * carry main or browser).
 */
export function activationLintReasons(extension: ExtensionManifestSummary): readonly string[] {
        if (!extension.manifestPresent || extension.parseError !== undefined) {
                return []; // the presence/parse classes own those verdicts
        }
        const reasons: string[] = [];
        if (extension.publisher !== 'flauz') {
                reasons.push(`${extension.manifestPath}: publisher must be 'flauz' (the built-in id namespace; got ${JSON.stringify(extension.publisher)})`);
        }
        if (extension.main === undefined && extension.browser === undefined) {
                reasons.push(`${extension.manifestPath}: carries no main and no browser entrypoint (a command-activated extension must have one)`);
        }
        if (extension.activationEvents.includes('*')) {
                reasons.push(`${extension.manifestPath}: '*' activation is forbidden (R1)`);
        }
        for (const event of extension.activationEvents) {
                if (event === 'onStartupFinished') {
                        if (extension.id === undefined || !STARTUP_ALLOWED_IDS.has(extension.id)) {
                                reasons.push(`${extension.manifestPath}: onStartupFinished is budgeted for the bridge + workspace extensions only (R3; got id ${JSON.stringify(extension.id)})`);
                        }
                        continue;
                }
                if (!EVENT_SHAPES.some(shape => shape.test(event))) {
                        reasons.push(`${extension.manifestPath}: activation event ${JSON.stringify(event)} is not on the whitelisted command/view/task-type/provider families (R2)`);
                }
        }
        return reasons;
}

/** The expected extension name set: the union of the parity surfaces + the SBOM extension components. */
export function expectedExtensionNames(product: ProductState): readonly string[] {
        const names = new Set<string>();
        for (const surface of product.parity.extensionSurfaces) {
                names.add(surface.slice(`${PRODUCT_EXTENSIONS_DIR}/`.length));
        }
        for (const component of product.sbom.extensionComponents) {
                names.add(component.name);
        }
        return [...names].sort();
}

/**
 * The extension census: every packaged extension present + activation-lint
 * clean. A manifest the registries name that is missing or unparseable is a
 * TORN install (incomplete); a manifest that violates the activation rules
 * or the id/entrypoint laws is TAMPERED.
 */
export function checkExtensionCensus(product: ProductState): ProductCheck {
        const reasons: string[] = [];
        let verdict: ProductVerdict = 'green';
        const live = new Map(product.extensions.map(extension => [extension.name, extension] as const));
        const expected = expectedExtensionNames(product);
        for (const name of expected) {
                const extension = live.get(name);
                if (extension === undefined || !extension.manifestPresent) {
                        verdict = worse(verdict, 'torn');
                        reasons.push(`extensions/${name}/package.json is missing from the product state (the packaged extension the registries name is absent -- an incomplete install)`);
                        continue;
                }
                if (extension.parseError !== undefined) {
                        verdict = worse(verdict, 'torn');
                        reasons.push(`extensions/${name}/package.json does not parse (${extension.parseError}) -- the manifest is structurally incomplete`);
                        continue;
                }
        }
        for (const extension of product.extensions) {
                if (!extension.manifestPresent || extension.parseError !== undefined) {
                        continue; // already classified above when expected; unparseable-but-unexpected is the parity class's coverage drift
                }
                for (const reason of activationLintReasons(extension)) {
                        verdict = worse(verdict, 'tampered');
                        reasons.push(reason);
                }
        }
        return {
                check: 'extensions',
                verdict,
                reasons,
                counts: {
                        expectedExtensionCount: expected.length,
                        liveManifestCount: product.extensions.filter(extension => extension.manifestPresent && extension.parseError === undefined).length,
                        lintCleanCount: product.extensions.filter(extension => extension.manifestPresent && extension.parseError === undefined && activationLintReasons(extension).length === 0).length,
                },
        };
}

/**
 * The packaging-parity contract (rows vs manifests, the PP2/PP4 semantics
 * re-derived): an unparseable/absent registry is TORN (the machine contract
 * itself is broken); a live manifest without rows, or a posture row whose
 * class no longer re-derives from the live manifest, is TAMPERED (drift); a
 * row citing a surface with no live manifest is TORN (the incomplete-install
 * reading -- the extensions census names the same defect from its side).
 */
export function checkParityContract(product: ProductState): ProductCheck {
        const reasons: string[] = [];
        let verdict: ProductVerdict = 'green';
        if (!product.parity.present) {
                return {
                        check: 'parity',
                        verdict: 'torn',
                        reasons: [`${PRODUCT_PARITY_REGISTRY_PATH} is absent from the product state -- the packaging-parity machine contract itself is incomplete`],
                        counts: { rowCount: 0 },
                };
        }
        if (product.parity.parseError !== undefined) {
                return {
                        check: 'parity',
                        verdict: 'torn',
                        reasons: [`${PRODUCT_PARITY_REGISTRY_PATH} does not parse (${product.parity.parseError}) -- the machine contract is structurally broken`],
                        counts: { rowCount: 0 },
                };
        }
        const liveDirs = new Set(product.extensions.map(extension => extension.extensionDir));
        for (const extension of product.extensions) {
                const covered = product.parity.extensionSurfaces.includes(extension.extensionDir);
                if (!covered) {
                        verdict = worse(verdict, 'tampered');
                        reasons.push(`${extension.extensionDir} carries no packaging-parity rows (an unclassified surface is a violation -- PP2)`);
                }
        }
        for (const surface of product.parity.extensionSurfaces) {
                if (!liveDirs.has(surface)) {
                        verdict = worse(verdict, 'torn');
                        reasons.push(`the parity registry covers ${surface} but the product state does not carry it (incomplete install or vanished surface -- PP2 drift)`);
                }
        }
        // PP4 posture re-derivation: main-only means web-blocked; a browser entrypoint means web-full|web-degraded.
        for (const extension of product.extensions) {
                if (!extension.manifestPresent || extension.parseError !== undefined) {
                        continue;
                }
                const postureRows = product.parity.rows.filter(row => row.surface === extension.extensionDir && row.capability === 'extension packaging posture');
                if (postureRows.length === 0) {
                        continue; // PP2 requires >=1 row, not a posture row specifically; the coverage check above owns absence
                }
                for (const row of postureRows) {
                        const rederived = extension.browser !== undefined ? (row.class === 'web-full' || row.class === 'web-degraded') : (extension.main !== undefined && row.class === 'web-blocked');
                        if (!rederived) {
                                verdict = worse(verdict, 'tampered');
                                reasons.push(`${extension.extensionDir}'s posture row declares class '${row.class}' but the live manifest is ${extension.browser !== undefined ? 'browser-carrying (web-full|web-degraded expected)' : 'main-only (web-blocked expected -- upstream isWebExtension())'} -- the posture no longer re-derives (PP4 drift)`);
                        }
                }
        }
        return {
                check: 'parity',
                verdict,
                reasons,
                counts: {
                        rowCount: product.parity.rowCount,
                        extensionSurfaceCount: product.parity.extensionSurfaces.length,
                },
        };
}

/**
 * The SBOM component coverage: every live flauz-* extension has a component
 * row, every extension component has a live manifest (torn -- the
 * incomplete-install reading), and the dependency graph covers every
 * component (tampered when it does not).
 */
export function checkSbomCoverage(product: ProductState): ProductCheck {
        const reasons: string[] = [];
        let verdict: ProductVerdict = 'green';
        if (!product.sbom.present) {
                return {
                        check: 'sbom',
                        verdict: 'torn',
                        reasons: [`${PRODUCT_SBOM_PATH} is absent from the product state -- the component inventory itself is incomplete`],
                        counts: { componentCount: 0 },
                };
        }
        if (product.sbom.parseError !== undefined) {
                return {
                        check: 'sbom',
                        verdict: 'torn',
                        reasons: [`${PRODUCT_SBOM_PATH} does not parse (${product.sbom.parseError}) -- the component inventory is structurally broken`],
                        counts: { componentCount: 0 },
                };
        }
        const componentNames = new Set(product.sbom.extensionComponents.map(component => component.name));
        for (const extension of product.extensions) {
                if (!componentNames.has(extension.name)) {
                        verdict = worse(verdict, 'tampered');
                        reasons.push(`${extension.extensionDir} has no SBOM component row (an untracked component -- the inventory must cover every packaged extension)`);
                }
        }
        const liveNames = new Set(product.extensions.map(extension => extension.name));
        for (const component of product.sbom.extensionComponents) {
                if (!liveNames.has(component.name)) {
                        verdict = worse(verdict, 'torn');
                        reasons.push(`the SBOM tracks component '${component.name}' but the product state does not carry it (incomplete install or vanished surface)`);
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
                },
        };
}

/** Runs all three product checks (the install verification's product half). */
export function productChecks(product: ProductState): readonly ProductCheck[] {
        return [checkExtensionCensus(product), checkParityContract(product), checkSbomCoverage(product)];
}
