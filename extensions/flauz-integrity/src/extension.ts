/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Integrity extension activation (A-PROD-005-W2, TL-A).
 *
 * Activation discipline (activation-lint R1-R3): command activation ONLY
 * (`onCommand:flauz.integrity.*`) -- never `*`, never onStartupFinished
 * (that budget is bridge + workspace only).
 *
 * Wires the node IntegrityFsPort (readFileUtf8 + readFileBytes + the write
 * surface) and THIS WAVE'S SEAM: the node KeyPort over node:crypto's
 * ed25519 surface (generateKeyPairSync / sign / verify, with the
 * workspace-local key store at `.flauz/integrity/keys/ed25519-local-dev.json`
 * -- the port owns the path; the private key NEVER leaves the store: only
 * public material + derived signatures cross the port boundary). The wall
 * clock, the output channel, the workspace-root + repo-state product-root
 * probes follow the flauz-production wiring precedent.
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as nodeCrypto from 'node:crypto';
import { setVscodeApi } from './globals.ts';
import {
        type IntegrityFsPort,
        type KeyInfo,
        type KeyPort,
        INTEGRITY_TASK_ID,
        KEY_POSTURE,
        KEY_STORE_PATH,
        KEY_STORE_SCHEMA_ID,
        SIGNING_ALGORITHM,
        IntegrityError,
        isProductRoot,
        isPublicKeyHex,
        isSha256Hex,
        joinPath,
} from './api.ts';
import { registerIntegrityCommands, type IntegrityCommandServices } from './commands.ts';

const nodeFs: IntegrityFsPort = {
        readFileUtf8: async path => {
                try {
                        return await fs.readFile(path, { encoding: 'utf-8' });
                } catch (err) {
                        if ((err as { code?: string }).code === 'ENOENT') {
                                return undefined;
                        }
                        throw err;
                }
        },
        readFileBytes: async path => {
                try {
                        return await fs.readFile(path);
                } catch (err) {
                        if ((err as { code?: string }).code === 'ENOENT') {
                                return undefined;
                        }
                        throw err;
                }
        },
        readdir: async path => {
                try {
                        return await fs.readdir(path);
                } catch (err) {
                        // Unlistable = missing (ENOENT) OR a non-directory path (ENOTDIR):
                        // both surface as undefined so the readers treat the path as a
                        // leaf, never crash on a file-where-a-dir-was-probed.
                        const code = (err as { code?: string }).code;
                        if (code === 'ENOENT' || code === 'ENOTDIR') {
                                return undefined;
                        }
                        throw err;
                }
        },
        mkdir: path => fs.mkdir(path, { recursive: true }),
        writeFile: (path, contents) => fs.writeFile(path, contents, { encoding: 'utf-8' }),
        appendFile: (path, contents) => fs.appendFile(path, contents, { encoding: 'utf-8' }),
};

// ---------------------------------------------------------------------------
// The node KeyPort (ed25519 through node:crypto; the workspace-local store)
// ---------------------------------------------------------------------------

/** The KeyPort-owned store body (NEVER a record surface; never swept, never banked, never rendered). */
interface KeyStoreBody {
        readonly $schema: string;
        readonly algorithm: string;
        readonly keyPosture: string;
        readonly publicKeyHex: string;
        readonly privateKeyHex: string;
        readonly fingerprint: string;
        readonly createdAt: number;
}

/** The ed25519 SPKI/PKCS8 DER tails: the raw key material offsets (fixed by the algorithm's DER framing). */
const ED25519_SPKI_LENGTH = 44;
const ED25519_PKCS8_LENGTH = 48;

function rawBytesFromKeyObject(key: nodeCrypto.KeyObject, kind: 'public' | 'private'): Uint8Array {
        const der = kind === 'public' ? key.export({ type: 'spki', format: 'der' }) : key.export({ type: 'pkcs8', format: 'der' });
        const expected = kind === 'public' ? ED25519_SPKI_LENGTH : ED25519_PKCS8_LENGTH;
        if (der.length !== expected) {
                throw new IntegrityError('FLAUZ_INTEGRITY_KEY_STORE', `flauz.integrity/v1: unexpected ed25519 ${kind} DER length (${String(der.length)}, expected ${String(expected)})`);
        }
        return der.subarray(der.length - 32);
}

function base64Url(bytes: Uint8Array): string {
        return Buffer.from(bytes).toString('base64url');
}

function hexOf(bytes: Uint8Array): string {
        return Buffer.from(bytes).toString('hex');
}

function unhex(hex: string): Uint8Array {
        return new Uint8Array(Buffer.from(hex, 'hex'));
}

function publicJwk(publicKeyHex: string): Record<string, unknown> {
        return { kty: 'OKP', crv: 'Ed25519', x: base64Url(unhex(publicKeyHex)) };
}

function privateJwk(publicKeyHex: string, privateKeyHex: string): Record<string, unknown> {
        return { kty: 'OKP', crv: 'Ed25519', x: base64Url(unhex(publicKeyHex)), d: base64Url(unhex(privateKeyHex)) };
}

function validateStoreBody(value: unknown): KeyStoreBody | undefined {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                return undefined;
        }
        const record = value as Record<string, unknown>;
        if (record.$schema !== KEY_STORE_SCHEMA_ID || record.algorithm !== SIGNING_ALGORITHM || record.keyPosture !== KEY_POSTURE) {
                return undefined;
        }
        if (!isPublicKeyHex(record.publicKeyHex) || !isSha256Hex(record.privateKeyHex) || !isSha256Hex(record.fingerprint)) {
                return undefined;
        }
        if (typeof record.createdAt !== 'number' || !Number.isSafeInteger(record.createdAt) || record.createdAt <= 0) {
                return undefined;
        }
        return {
                $schema: KEY_STORE_SCHEMA_ID,
                algorithm: SIGNING_ALGORITHM,
                keyPosture: KEY_POSTURE,
                publicKeyHex: record.publicKeyHex,
                privateKeyHex: record.privateKeyHex,
                fingerprint: record.fingerprint,
                createdAt: record.createdAt,
        };
}

async function readStore(root: string): Promise<KeyStoreBody | undefined> {
        const text = await nodeFs.readFileUtf8(joinPath(root, KEY_STORE_PATH));
        if (text === undefined) {
                return undefined;
        }
        try {
                return validateStoreBody(JSON.parse(text));
        } catch {
                return undefined;
        }
}

async function writeStore(root: string, body: KeyStoreBody): Promise<void> {
        await nodeFs.mkdir(joinPath(root, KEY_STORE_PATH).split('/').slice(0, -1).join('/'));
        await nodeFs.writeFile(joinPath(root, KEY_STORE_PATH), `${JSON.stringify(body, null, 2)}\n`);
}

function infoOf(body: KeyStoreBody): KeyInfo {
        return { publicKeyHex: body.publicKeyHex, fingerprint: body.fingerprint, createdAt: body.createdAt };
}

/** The node ed25519 KeyPort: THE SEAM this wave drives (the store path is owned here). */
const nodeKeyPort: KeyPort = {
        getOrCreateKeyInfo: async root => {
                const existing = await readStore(root);
                if (existing !== undefined) {
                        return { status: 'loaded', info: infoOf(existing) };
                }
                // a store file that exists but does not validate is the typed KEY_STORE refusal
                // (never silently regenerate over a suspect store: fail-closed custody)
                const rawText = await nodeFs.readFileUtf8(joinPath(root, KEY_STORE_PATH));
                if (rawText !== undefined) {
                        throw new IntegrityError('FLAUZ_INTEGRITY_KEY_STORE', `flauz.integrity/v1: the workspace-local key store at ${KEY_STORE_PATH} exists but does not validate (torn store) -- REFUSING to regenerate over it (fail-closed custody; delete the store deliberately to re-mint a local-dev key)`);
                }
                const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519');
                const publicKeyHex = hexOf(rawBytesFromKeyObject(publicKey, 'public'));
                const privateKeyHex = hexOf(rawBytesFromKeyObject(privateKey, 'private'));
                const fingerprint = nodeCrypto.createHash('sha256').update(unhex(publicKeyHex)).digest('hex');
                const createdAt = Date.now();
                await writeStore(root, {
                        $schema: KEY_STORE_SCHEMA_ID,
                        algorithm: SIGNING_ALGORITHM,
                        keyPosture: KEY_POSTURE,
                        publicKeyHex,
                        privateKeyHex,
                        fingerprint,
                        createdAt,
                });
                return { status: 'generated', info: { publicKeyHex, fingerprint, createdAt } };
        },
        peekKeyInfo: async root => {
                const existing = await readStore(root);
                if (existing !== undefined) {
                        return { status: 'present', info: infoOf(existing) };
                }
                const rawText = await nodeFs.readFileUtf8(joinPath(root, KEY_STORE_PATH));
                if (rawText !== undefined) {
                        return { status: 'torn', error: 'the key store file exists but does not validate as a flauz.integrity-keystore/v1 body' };
                }
                return { status: 'absent' };
        },
        signBytes: async (root, bytes) => {
                const store = await readStore(root);
                if (store === undefined) {
                        throw new IntegrityError('FLAUZ_INTEGRITY_KEY_STORE', `flauz.integrity/v1: no loadable key store under ${KEY_STORE_PATH} (the sign path generates it on first sign -- this is the torn-store or mid-run-deletion refusal)`);
                }
                const privateKey = nodeCrypto.createPrivateKey({ key: privateJwk(store.publicKeyHex, store.privateKeyHex), format: 'jwk' });
                return nodeCrypto.sign(null, bytes, privateKey);
        },
        verifyBytes: async (bytes, signature, publicKeyHex) => {
                if (!isPublicKeyHex(publicKeyHex)) {
                        return false;
                }
                const publicKey = nodeCrypto.createPublicKey({ key: publicJwk(publicKeyHex), format: 'jwk' });
                return nodeCrypto.verify(null, bytes, publicKey, signature);
        },
};

/** The synthetic taskId re-export keeps the banking provenance visible at the wiring row. */
export const integrityTaskId = INTEGRITY_TASK_ID;

export function activate(context: vscode.ExtensionContext): void {
        setVscodeApi(vscode);

        const channel = vscode.window.createOutputChannel('Flauz Integrity');
        const services: IntegrityCommandServices = {
                fs: nodeFs,
                clock: (): number => Date.now(),
                channel,
                keys: nodeKeyPort,
                getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                getProductRoot: async () => {
                        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                        if (root === undefined) {
                                return undefined;
                        }
                        return await isProductRoot(root, nodeFs) ? root : undefined;
                },
        };

        for (const disposable of [channel, ...registerIntegrityCommands(services)]) {
                context.subscriptions.push(disposable);
        }
}

export function deactivate(): void {
        // Nothing to do -- all disposables ride context.subscriptions.
}
