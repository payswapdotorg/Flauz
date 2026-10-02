/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The repo-state product registry reader (A-PROD-005-W1, contract-duplicated
 * from the W5 flauz-release productState.ts -- THE SEAM this wave drives; the
 * duplication is pinned against the real owning module by
 * test/contract.test.ts: same fixture root -> same summaries, same lint
 * reasons, same expected names).
 *
 * THE PRODUCT-STATE LAW (the W5 evidence law, verbatim): the product
 * registry is the REPO-STATE PRODUCT -- the `extensions/flauz-*` manifests
 * (the packaged extension set), `build/flauz/packaging-parity.json` (the
 * TL1-005 machine contract: rows vs manifests) and
 * `build/flauz/security/flauz-sbom.json` (the security-runtime-gate component
 * inventory). A root carrying none of these is not a product state and the
 * verification refuses typed (FLAUZ_PRODUCTION_NO_PRODUCT_STATE).
 *
 * THIS WAVE'S EXTENSION of the W5 summary: the manifest summary also carries
 * the contributed COMMAND ids (`contributes.commands[].command`) -- the
 * capability surface the matrix derives its rows from. The census/matrix/gate
 * consult the same reader; every surface enumerated is a SHAPE (paths,
 * versions, ids, command ids, classes) -- the metadata law; never contents.
 */

import {
        PRODUCT_EXTENSIONS_DIR,
        PRODUCT_PARITY_REGISTRY_PATH,
        PRODUCT_SBOM_PATH,
        isPlainObject,
        joinPath,
        type ProductionFsPort,
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
        /** The contributed command ids (the capability surface the matrix derives from). */
        readonly commands: readonly string[];
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

/** The whole product state, as the census/matrix/gate consume it. */
export interface ProductState {
        readonly productRoot: string;
        readonly extensions: readonly ExtensionManifestSummary[];
        readonly parity: ParityRegistrySummary;
        readonly sbom: SbomSummary;
}

/**
 * The product-state signature probe (the W5 port, contract-duplicated): a
 * root carrying the parity registry is repo-state-product-shaped (the
 * registry is the machine contract that pins the packaged surface set; the
 * wiring layer resolves the workspace root's product state through this
 * probe).
 */
export async function isProductRoot(root: string, fs: ProductionFsPort): Promise<boolean> {
        const text = await fs.readFileUtf8(joinPath(root, PRODUCT_PARITY_REGISTRY_PATH));
        return text !== undefined;
}

/** Extracts the contributed command ids from a parsed manifest body (a shape projection, never contents). */
function contributedCommands(parsed: Record<string, unknown>): string[] {
        const contributes = parsed.contributes;
        if (!isPlainObject(contributes) || !Array.isArray(contributes.commands)) {
                return [];
        }
        const out: string[] = [];
        for (const entry of contributes.commands) {
                if (isPlainObject(entry) && typeof entry.command === 'string' && entry.command.length > 0) {
                        out.push(entry.command);
                }
        }
        return [...new Set(out)].sort();
}

/**
 * Reads the product state from a repo-shaped root. Returns undefined when
 * the root carries no `extensions/` directory (not a product state -- the
 * caller's typed refusal). Absent registry/SBOM are reported INSIDE the
 * summaries (the check classes carry the torn verdicts, the reader never
 * guesses).
 */
export async function readProductState(productRoot: string, fs: ProductionFsPort): Promise<ProductState | undefined> {
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
                        extensions.push({ extensionDir, manifestPath, name, manifestPresent: false, activationEvents: [], commands: [] });
                        continue;
                }
                let parsed: unknown;
                try {
                        parsed = JSON.parse(text);
                } catch (err) {
                        extensions.push({ extensionDir, manifestPath, name, manifestPresent: true, parseError: (err as Error).message, activationEvents: [], commands: [] });
                        continue;
                }
                if (!isPlainObject(parsed)) {
                        extensions.push({ extensionDir, manifestPath, name, manifestPresent: true, parseError: 'the manifest is not a JSON object', activationEvents: [], commands: [] });
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
                        commands: contributedCommands(parsed),
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
// The activation-lint mirror + the registry-derived expectations
// ---------------------------------------------------------------------------

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
 * The activation-lint mirror over one manifest summary (the W5 mirror,
 * contract-duplicated from build/flauz/scripts/activation-lint.mjs R1-R3):
 * returns the violation reasons (empty = clean). R1: '*' forbidden; R2:
 * whitelisted event shapes only; R3: onStartupFinished only for the allowed
 * ids; plus the built-in id law (publisher flauz, the manifest name matching
 * its directory) and the entrypoint law (a command-activated manifest must
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
 * The PP4 posture re-derivation over one manifest summary: a browser
 * entrypoint means web-full|web-degraded expected; a main-only manifest
 * means web-blocked expected. Returns the drift reasons (empty = clean).
 */
export function postureDriftReasons(extension: ExtensionManifestSummary, postureRows: readonly { class: string }[]): readonly string[] {
        const reasons: string[] = [];
        for (const row of postureRows) {
                const rederived = extension.browser !== undefined
                        ? (row.class === 'web-full' || row.class === 'web-degraded')
                        : (extension.main !== undefined && row.class === 'web-blocked');
                if (!rederived) {
                        reasons.push(`${extension.extensionDir}'s posture row declares class '${row.class}' but the manifest is ${extension.browser !== undefined ? 'browser-carrying (web-full|web-degraded expected)' : 'main-only (web-blocked expected -- upstream isWebExtension())'} -- the posture no longer re-derives (PP4 drift)`);
                }
        }
        return reasons;
}
