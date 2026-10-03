/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared fixture boot for the flauz-integrity suite (A-PROD-005-W2).
 *
 * EVIDENCE LEVEL -- local-real: the fixture products are REAL trees (real
 * `extensions/<name>/package.json` manifests, real `dist/extension.js`
 * artifact BYTES, a real bundle manifest whose pins are RE-DERIVED from those
 * bytes with node:crypto at boot); the key fixtures run REAL ed25519 through
 * node:crypto (the desktop lane's own surface); the REAL repo root's
 * committed bundle manifest is consulted by the contract suite (shape
 * invariants only -- count-free assertions that hold at the worker base AND
 * at the post-landing station, where the regenerated manifest carries this
 * wave's own pin: the suite is station-stable by design).
 *
 * Never claim runtime-real for production key custody (the local-dev key
 * posture is the disclosed boundary; the ports are the seam an operator-key
 * deployment drives).
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as nodeCrypto from 'node:crypto';

import type { IntegrityFsPort, KeyInfo, KeyPort } from '../src/api.ts';
import { IntegrityError, KEY_POSTURE, KEY_STORE_PATH, KEY_STORE_SCHEMA_ID, SIGNING_ALGORITHM, isPublicKeyHex, isSha256Hex, joinPath } from '../src/api.ts';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

/** The real repo root (the committed bundle manifest is the contract suite's local-real subject). */
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

/** The flauz-integrity IntegrityFsPort over node:fs (the extension-host wiring, mirrored in the test lane). */
export function nodeIntegrityFs(): IntegrityFsPort {
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
                readFileBytes: async target => {
                        try {
                                return await fs.readFile(target);
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
// The key-port fixtures (REAL ed25519 through node:crypto -- the local-real lane)
// ---------------------------------------------------------------------------

const b64u = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const hexOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const unhex = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'));

/** The ed25519 PKCS8 DER prefix (the fixed framing over a 32-byte seed). */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function privateKeyObject(publicKeyHex: string, privateKeyHex: string): nodeCrypto.KeyObject {
        return nodeCrypto.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64u(unhex(publicKeyHex)), d: b64u(unhex(privateKeyHex)) }, format: 'jwk' });
}

function publicKeyObject(publicKeyHex: string): nodeCrypto.KeyObject {
        return nodeCrypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64u(unhex(publicKeyHex)) }, format: 'jwk' });
}

interface StoreBody {
        readonly $schema: string;
        readonly algorithm: string;
        readonly keyPosture: string;
        readonly publicKeyHex: string;
        readonly privateKeyHex: string;
        readonly fingerprint: string;
        readonly createdAt: number;
}

function validateStoreBody(value: unknown): StoreBody | undefined {
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
        return record as unknown as StoreBody;
}

async function readStore(root: string): Promise<StoreBody | undefined> {
        const text = await fs.readFile(path.join(root, KEY_STORE_PATH), 'utf-8').catch((err: { code?: string }) => (err.code === 'ENOENT' ? undefined : Promise.reject(err)));
        if (text === undefined) {
                return undefined;
        }
        try {
                return validateStoreBody(JSON.parse(text));
        } catch {
                return undefined;
        }
}

async function writeStore(root: string, body: StoreBody): Promise<void> {
        await fs.mkdir(path.join(root, path.dirname(KEY_STORE_PATH)), { recursive: true });
        await fs.writeFile(path.join(root, KEY_STORE_PATH), `${JSON.stringify(body, null, 2)}\n`, 'utf-8');
}

/**
 * The real node KeyPort fixture (the extension.ts wiring mirrored into the
 * test lane, the nodeProductionFs precedent): REAL random ed25519 keygen on
 * first sign, the same store discipline, sign/verify through node:crypto.
 */
export function realNodeKeyPort(): KeyPort {
        return {
                getOrCreateKeyInfo: async root => {
                        const existing = await readStore(root);
                        if (existing !== undefined) {
                                return { status: 'loaded', info: { publicKeyHex: existing.publicKeyHex, fingerprint: existing.fingerprint, createdAt: existing.createdAt } };
                        }
                        const rawText = await fs.readFile(path.join(root, KEY_STORE_PATH), 'utf-8').catch((err: { code?: string }) => (err.code === 'ENOENT' ? undefined : Promise.reject(err)));
                        if (rawText !== undefined) {
                                throw new IntegrityError('FLAUZ_INTEGRITY_KEY_STORE', 'flauz.integrity/v1: the workspace-local key store exists but does not validate (torn store) -- REFUSING to regenerate over it');
                        }
                        const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519');
                        const spki = publicKey.export({ type: 'spki', format: 'der' });
                        const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
                        const publicKeyHex = hexOf(spki.subarray(spki.length - 32));
                        const privateKeyHex = hexOf(pkcs8.subarray(pkcs8.length - 32));
                        const fingerprint = nodeCrypto.createHash('sha256').update(unhex(publicKeyHex)).digest('hex');
                        const createdAt = Date.now();
                        await writeStore(root, { $schema: KEY_STORE_SCHEMA_ID, algorithm: SIGNING_ALGORITHM, keyPosture: KEY_POSTURE, publicKeyHex, privateKeyHex, fingerprint, createdAt });
                        return { status: 'generated', info: { publicKeyHex, fingerprint, createdAt } };
                },
                peekKeyInfo: async root => {
                        const existing = await readStore(root);
                        if (existing !== undefined) {
                                return { status: 'present', info: { publicKeyHex: existing.publicKeyHex, fingerprint: existing.fingerprint, createdAt: existing.createdAt } };
                        }
                        const rawText = await fs.readFile(path.join(root, KEY_STORE_PATH), 'utf-8').catch((err: { code?: string }) => (err.code === 'ENOENT' ? undefined : Promise.reject(err)));
                        if (rawText !== undefined) {
                                return { status: 'torn', error: 'the key store file exists but does not validate as a flauz.integrity-keystore/v1 body' };
                        }
                        return { status: 'absent' };
                },
                signBytes: async (root, bytes) => {
                        const store = await readStore(root);
                        if (store === undefined) {
                                throw new IntegrityError('FLAUZ_INTEGRITY_KEY_STORE', 'flauz.integrity/v1: no loadable key store (the sign path generates it on first sign)');
                        }
                        return nodeCrypto.sign(null, bytes, privateKeyObject(store.publicKeyHex, store.privateKeyHex));
                },
                verifyBytes: async (bytes, signature, publicKeyHex) => {
                        if (!isPublicKeyHex(publicKeyHex)) {
                                return false;
                        }
                        return nodeCrypto.verify(null, bytes, publicKeyObject(publicKeyHex), signature);
                },
        };
}

/**
 * The deterministic key-port fixture (the determinism law): the SAME node
 * KeyPort discipline, but the keypair is DERIVED from sha256(label) -- never
 * a key literal in source, never randomness -- so identical fixture inputs
 * produce byte-identical ledgers.
 */
export function deterministicKeyPort(label: string, createdAt = 1_740_100_000_000): KeyPort {
        const seed = nodeCrypto.createHash('sha256').update(`flauz-integrity-deterministic:${label}`).digest();
        const privateKey = nodeCrypto.createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
        const publicKey = nodeCrypto.createPublicKey(privateKey);
        const spki = publicKey.export({ type: 'spki', format: 'der' });
        const publicKeyHex = hexOf(spki.subarray(spki.length - 32));
        const privateKeyHex = hexOf(seed);
        const fingerprint = nodeCrypto.createHash('sha256').update(unhex(publicKeyHex)).digest('hex');
        const info: KeyInfo = { publicKeyHex, fingerprint, createdAt };
        return {
                getOrCreateKeyInfo: async root => {
                        const existing = await readStore(root);
                        if (existing !== undefined) {
                                return { status: 'loaded', info: { publicKeyHex: existing.publicKeyHex, fingerprint: existing.fingerprint, createdAt: existing.createdAt } };
                        }
                        await writeStore(root, { $schema: KEY_STORE_SCHEMA_ID, algorithm: SIGNING_ALGORITHM, keyPosture: KEY_POSTURE, publicKeyHex, privateKeyHex, fingerprint, createdAt: info.createdAt });
                        return { status: 'generated', info };
                },
                peekKeyInfo: async root => {
                        const existing = await readStore(root);
                        if (existing !== undefined) {
                                return { status: 'present', info: { publicKeyHex: existing.publicKeyHex, fingerprint: existing.fingerprint, createdAt: existing.createdAt } };
                        }
                        return { status: 'absent' };
                },
                signBytes: async (root, bytes) => {
                        const store = await readStore(root);
                        if (store === undefined) {
                                throw new IntegrityError('FLAUZ_INTEGRITY_KEY_STORE', 'flauz.integrity/v1: no loadable key store (the sign path generates it on first sign)');
                        }
                        return nodeCrypto.sign(null, bytes, privateKeyObject(store.publicKeyHex, store.privateKeyHex));
                },
                verifyBytes: async (bytes, signature, keyHex) => {
                        if (!isPublicKeyHex(keyHex)) {
                                return false;
                        }
                        return nodeCrypto.verify(null, bytes, publicKeyObject(keyHex), signature);
                },
        };
}

// ---------------------------------------------------------------------------
// The fixture product (real manifests + real artifact bytes + re-derived pins)
// ---------------------------------------------------------------------------

/** The injectable defects of a fixture product. */
export interface FixtureProductOptions {
        /** Delete the bundle manifest (the NO_MANIFEST refusal fixture). */
        readonly noManifest?: boolean;
        /** Corrupt the bundle manifest body (the MANIFEST_FORMAT refusal fixture). */
        readonly unparseableManifest?: boolean;
        /** Delete the parity registry (the no-product-state probe fixture). */
        readonly noParity?: boolean;
        /** flauz-beta's pin is doctored (the PIN_MISMATCH refusal fixture). */
        readonly wrongPin?: boolean;
        /** flauz-beta's dist artifact is deleted (the ARTIFACT_MISSING refusal fixture). */
        readonly missingArtifact?: boolean;
        /** A fourth bundle with TWO artifacts (multi-artifact coverage). */
        readonly extraBundle?: boolean;
}

/** Deterministic artifact bytes for a fixture bundle (real bytes, not placeholders). */
function fixtureArtifactBytes(bundle: string, rel: string): Buffer {
        return Buffer.from(`// fixture dist artifact for ${bundle} (${rel}) -- flauz-integrity test lane, real bytes hashed + signed by the real node:crypto ed25519 surface\n${bundle}:${rel}:${'x'.repeat(64)}\n`, 'utf-8');
}

/**
 * Boots a fixture repo-state product: extension manifests + REAL dist
 * artifact bytes + the parity registry + a bundle manifest whose pins are
 * RE-DERIVED from those bytes with node:crypto at boot (the same discipline
 * the station's --generate run follows: the pin is the hash of the bytes).
 */
export async function bootFixtureProduct(options: FixtureProductOptions = {}): Promise<{ root: string; artifactPaths: string[]; cleanup: () => Promise<void> }> {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-product-'));
        const bundles: Record<string, string[]> = {
                'flauz-alpha': ['dist/extension.js'],
                'flauz-beta': ['dist/extension.js'],
                'flauz-gamma': ['dist/extension.js'],
        };
        if (options.extraBundle === true) {
                bundles['flauz-delta'] = ['dist/extension.js', 'dist/worker.js'];
        }
        const artifactPaths: string[] = [];
        const pins: Record<string, { version: string; artifacts: Record<string, string> }> = {};
        for (const [bundle, rels] of Object.entries(bundles)) {
                const manifest = {
                        name: bundle,
                        displayName: `Fixture ${bundle}`,
                        description: `the ${bundle} fixture extension (integrity test lane)`,
                        version: '0.1.0',
                        publisher: 'flauz',
                        license: 'MIT',
                        type: 'module',
                        engines: { vscode: '^1.140.0' },
                        categories: ['Other'],
                        activationEvents: [`onCommand:flauz.${bundle.replace(/^flauz-/, '')}.thing`],
                        main: './dist/extension.js',
                        contributes: { commands: [{ command: `flauz.${bundle.replace(/^flauz-/, '')}.thing`, title: `Fixture ${bundle} Thing`, category: 'Flauz' }] },
                };
                await fs.mkdir(path.join(root, 'extensions', bundle, 'src'), { recursive: true });
                await fs.writeFile(path.join(root, 'extensions', bundle, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
                await fs.writeFile(path.join(root, 'extensions', bundle, 'src', 'api.ts'), 'export const fixture = 1;\n', 'utf-8');
                const artifacts: Record<string, string> = {};
                for (const rel of rels) {
                        const bytes = fixtureArtifactBytes(bundle, rel);
                        // the pin is ALWAYS derived from the would-be bytes -- a missingArtifact fixture
                        // pins an artifact whose file is absent (the ARTIFACT_MISSING refusal class)
                        artifacts[rel] = nodeCrypto.createHash('sha256').update(bytes).digest('hex');
                        if (options.missingArtifact === true && bundle === 'flauz-beta' && rel === 'dist/extension.js') {
                                continue;
                        }
                        await fs.mkdir(path.join(root, 'extensions', bundle, path.dirname(rel)), { recursive: true });
                        await fs.writeFile(path.join(root, 'extensions', bundle, rel), bytes);
                        artifactPaths.push(joinPath('extensions', bundle, rel));
                }
                pins[bundle] = { version: '0.1.0', artifacts };
        }
        if (options.wrongPin === true) {
                const beta = pins['flauz-beta'] as { artifacts: Record<string, string> };
                beta.artifacts['dist/extension.js'] = beta.artifacts['dist/extension.js'].slice(0, 63) + (beta.artifacts['dist/extension.js'].endsWith('0') ? '1' : '0');
        }
        if (options.noParity !== true) {
                await fs.mkdir(path.join(root, 'build', 'flauz'), { recursive: true });
                await fs.writeFile(path.join(root, 'build', 'flauz', 'packaging-parity.json'), `${JSON.stringify({ version: 1, description: 'fixture parity registry', rows: [] }, null, 2)}\n`, 'utf-8');
        }
        if (options.noManifest !== true) {
                await fs.mkdir(path.join(root, 'build', 'flauz', 'security'), { recursive: true });
                const body = options.unparseableManifest === true
                        ? '{ not a bundle manifest at all'
                        : `${JSON.stringify({ $schema: 'flauz.bundle-manifest/v1', manifestVersion: 1, status: 'PINNED', baseCommit: '0123456789abcdef0123456789abcdef01234567', bundles: pins }, null, 2)}\n`;
                await fs.writeFile(path.join(root, 'build', 'flauz', 'security', 'bundle-manifest.json'), body, 'utf-8');
        }
        return { root, artifactPaths, cleanup: async () => { await fs.rm(root, { recursive: true, force: true }); } };
}

// ---------------------------------------------------------------------------
// The fixture workspace (the durable state the banking path owns)
// ---------------------------------------------------------------------------

/** The injectable states of a fixture workspace. */
export interface FixtureWorkspaceOptions {
        /** Plant a well-formed evidence ledger + watermark (the banking resync fixture). */
        readonly withEvidence?: boolean;
}

/** Boots a minimal-but-real fixture workspace (durable-state files with their owning schema ids). */
export async function bootFixtureWorkspace(options: FixtureWorkspaceOptions = {}): Promise<{ root: string; cleanup: () => Promise<void> }> {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-wk-'));
        await fs.mkdir(path.join(root, '.flauz'), { recursive: true });
        if (options.withEvidence === true) {
                await fs.mkdir(path.join(root, '.flauz', 'evidence'), { recursive: true });
                const row = { seq: 1, ts: 1_740_000_000_000, taskId: 'flauz-workspace', kind: 'note', uri: '.flauz/tasks.json', sha256: 'a'.repeat(64), prev: null };
                const line = JSON.stringify(row); // canonical by construction (sorted keys)
                await fs.writeFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), `${line}\n`, 'utf-8');
                await fs.writeFile(path.join(root, '.flauz', 'evidence', 'size.json'), `${JSON.stringify({ $schema: 'flauz.evidence.size/v1', rowCount: 1, bytes: Buffer.byteLength(`${line}\n`), headSha256: 'b'.repeat(64), lastCheckpointSeq: null, updatedAt: 1_740_000_000_000 }, null, 2)}\n`, 'utf-8');
        }
        return { root, cleanup: async () => { await fs.rm(root, { recursive: true, force: true }); } };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Reads every file under a directory (recursive) as { path, text } -- the canary byte-scan vehicle. */
export async function readAllFiles(dir: string, skip?: (absPath: string) => boolean): Promise<{ path: string; text: string }[]> {
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
                        out.push(...await readAllFiles(target, skip));
                } else if (entry.isFile() && (skip === undefined || !skip(target))) {
                        out.push({ path: target, text: await fs.readFile(target, 'utf-8') });
                }
        }
        return out;
}

/** Assembles a canary-shaped token from fragments at runtime (the no-literal law; never a complete secret in source). */
export function canaryToken(kind: 'github' | 'openai' | 'aws' | 'bearer' | 'pem'): string {
        switch (kind) {
                case 'github': return `ghp_${'Frag'.repeat(10)}Xmp1`; // 20+ chars, ghp_ prefix
                case 'openai': return `sk-ant-${'frag'.repeat(8)}Zq2`; // sk-ant- prefix, 16+ chars
                case 'aws': return `AKIA${'QWER'.repeat(4)}`; // AKIA + exactly 16 chars (the pattern's word boundary)
                case 'bearer': return `Bearer ${'tok'.repeat(10)}AbCd`; // Bearer + 16+ chars
                case 'pem': return ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' '); // the PEM marker shape (assembled, never literal)
        }
}

/** node:crypto sha256 hex over bytes (the independent re-derivation the assertions pin against). */
export function nodeSha256Hex(bytes: Uint8Array): string {
        return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
}

/** Flips one byte of a buffer (the tamper fixture; returns a NEW buffer). */
export function flipOneByte(bytes: Uint8Array): Buffer {
        const copy = Buffer.from(bytes);
        copy[copy.length - 2] = copy[copy.length - 2] ^ 0xff;
        return copy;
}
