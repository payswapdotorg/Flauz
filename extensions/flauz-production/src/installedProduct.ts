/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The runtime installed-product port + reader (A-PROD-005-W1 -- the wave's
 * own machinery, the lane the W5 report reserved: "the live installed-APP
 * product census (vscode.extensions.all over the shipped dist tree +
 * service-side parity/SBOM surfaces) is A-PROD-005's production-readiness
 * lane; the extension's ports (the product-root probe) are the designed seam
 * for it").
 *
 * THE INSTALLED-PRODUCT LAW: the census enumerates the product the RUNTIME
 * actually loaded -- the InstalledProductPort is the seam a real install
 * drives (the host wires vscode.extensions.all; tests wire fixture
 * installed-products constructed through the product-root ports, i.e. real
 * `extensions/<name>/package.json` trees). The reader then:
 *
 *   - resolves every runtime-listed flauz extension to its ON-DISK manifest
 *     (the dist-tree angle: <extensionPath>/package.json -- a manifest that
 *     is missing or unparseable is a TORN install; one whose declared
 *     version or id DISAGREES with what the runtime loaded is TAMPERED --
 *     the runtime-vs-disk consistency check is this wave's addition);
 *   - never guesses: an absent runtime surface (no installed product) is a
 *     TYPED degradation the census carries, never a silent green.
 */

import { isPlainObject, joinPath, type ProductionFsPort } from './api.ts';

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/** One runtime-loaded extension as the host reports it (a shape, never contents). */
export interface RuntimeExtensionInfo {
        /** The extension id (`flauz.<name>`). */
        readonly id: string;
        /** The version the runtime loaded (its parsed packageJSON.version). */
        readonly version: string;
        /** The installed extension's on-disk directory (the dist-tree root for its manifest). */
        readonly extensionPath: string;
}

/**
 * The runtime installed-product port: enumerates the flauz extension set the
 * runtime ACTUALLY loaded. `undefined` = the runtime surface is ABSENT (no
 * installed product -- the honest worker-sandbox state; the census degrades
 * typed). An empty array = the runtime enumerated and loaded ZERO flauz
 * extensions (an honest-but-empty product -- also a typed degradation, the
 * exact reason differs).
 */
export interface InstalledProductPort {
        listFlauzExtensions(): Promise<readonly RuntimeExtensionInfo[] | undefined>;
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

/** One installed extension's census summary (runtime + on-disk manifest, shapes only). */
export interface InstalledExtensionSummary {
        /** The runtime-reported id. */
        readonly id: string;
        /** The runtime-reported version. */
        readonly runtimeVersion: string;
        /** The installed extension directory (absolute, as the runtime reported it). */
        readonly extensionPath: string;
        readonly manifestPresent: boolean;
        readonly parseError?: string;
        readonly publisher?: string;
        /** The manifest-declared version (undefined when absent/unparseable). */
        readonly manifestVersion?: string;
        readonly main?: string;
        readonly browser?: string;
        readonly activationEvents: readonly string[];
        readonly enginesVscode?: string;
        /** The contributed command ids (the capability surface). */
        readonly commands: readonly string[];
        /** True when the manifest-declared name DISAGREES with the runtime id's name half. */
        readonly idMismatch?: boolean;
        /** True when the manifest-declared version DISAGREES with the runtime-loaded version. */
        readonly versionMismatch?: boolean;
}

/** The whole installed product, as the census consumes it. */
export interface InstalledProduct {
        /** How the installed product was resolved. */
        readonly source: 'runtime-port';
        readonly installRoot: string;
        readonly extensions: readonly InstalledExtensionSummary[];
}

/** Reads one installed extension's on-disk manifest into a summary (never throws on parse; the summary carries the error). */
async function readInstalledManifest(info: RuntimeExtensionInfo, fs: ProductionFsPort): Promise<InstalledExtensionSummary> {
        const manifestPath = joinPath(info.extensionPath, 'package.json');
        const text = await fs.readFileUtf8(manifestPath);
        if (text === undefined) {
                return { id: info.id, runtimeVersion: info.version, extensionPath: info.extensionPath, manifestPresent: false, activationEvents: [], commands: [] };
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch (err) {
                return { id: info.id, runtimeVersion: info.version, extensionPath: info.extensionPath, manifestPresent: true, parseError: (err as Error).message, activationEvents: [], commands: [] };
        }
        if (!isPlainObject(parsed)) {
                return { id: info.id, runtimeVersion: info.version, extensionPath: info.extensionPath, manifestPresent: true, parseError: 'the manifest is not a JSON object', activationEvents: [], commands: [] };
        }
        const publisher = typeof parsed.publisher === 'string' ? parsed.publisher : undefined;
        const manifestName = typeof parsed.name === 'string' ? parsed.name : undefined;
        const manifestVersion = typeof parsed.version === 'string' ? parsed.version : undefined;
        const main = typeof parsed.main === 'string' ? parsed.main : undefined;
        const browser = typeof parsed.browser === 'string' ? parsed.browser : undefined;
        const activationEvents = Array.isArray(parsed.activationEvents) ? parsed.activationEvents.filter((event): event is string => typeof event === 'string') : [];
        const engines = isPlainObject(parsed.engines) && typeof (parsed.engines as Record<string, unknown>).vscode === 'string' ? (parsed.engines as Record<string, unknown>).vscode as string : undefined;
        const commands: string[] = [];
        if (isPlainObject(parsed.contributes) && Array.isArray(parsed.contributes.commands)) {
                for (const entry of parsed.contributes.commands) {
                        if (isPlainObject(entry) && typeof entry.command === 'string' && entry.command.length > 0) {
                                commands.push(entry.command);
                        }
                }
        }
        const expectedName = info.id.startsWith('flauz.') ? info.id.slice('flauz.'.length) : undefined;
        const idMismatch = publisher !== 'flauz' || manifestName === undefined || (expectedName !== undefined && manifestName !== expectedName);
        const versionMismatch = manifestVersion !== undefined && manifestVersion !== info.version;
        return {
                id: info.id,
                runtimeVersion: info.version,
                extensionPath: info.extensionPath,
                manifestPresent: true,
                publisher,
                manifestVersion,
                main,
                browser,
                activationEvents,
                enginesVscode: engines,
                commands: [...new Set(commands)].sort(),
                ...(idMismatch ? { idMismatch: true } : {}),
                ...(versionMismatch ? { versionMismatch: true } : {}),
        };
}

/**
 * Reads the installed product through the runtime port: every runtime-listed
 * flauz extension resolved to its on-disk manifest. `undefined` = the port
 * reports no installed product (the typed degradation the census carries).
 * The install root is the common parent of the reported extension paths when
 * derivable (informational shape only).
 */
export async function readInstalledProduct(port: InstalledProductPort, fs: ProductionFsPort): Promise<InstalledProduct | undefined> {
        const infos = await port.listFlauzExtensions();
        if (infos === undefined) {
                return undefined;
        }
        const extensions: InstalledExtensionSummary[] = [];
        for (const info of [...infos].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
                extensions.push(await readInstalledManifest(info, fs));
        }
        let installRoot = '';
        for (const info of infos) {
                const marker = `${info.extensionPath.split('/').slice(0, -1).join('/')}/`;
                if (installRoot === '') {
                        installRoot = marker;
                } else if (installRoot !== marker) {
                        installRoot = '(multi-root install)';
                        break;
                }
        }
        return { source: 'runtime-port', installRoot: infos.length === 0 ? '' : installRoot, extensions };
}
