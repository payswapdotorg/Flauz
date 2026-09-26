/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Checkpoint-signer implementations for the DL-20 ledger hardening (Wave 4,
 * Lane K). The flauz-workspace core defines the CheckpointSigner PORT (api.ts)
 * and keeps zero node imports; this file owns the node:crypto-backed
 * implementations, mirroring how extension.ts owns the node FileSystemPort:
 *
 *   - Ed25519Signer    (preferred): node:crypto ed25519 over
 *                       signedPayload(rowSeq, headSha256) - asymmetric; the
 *                       verifying side needs the PUBLIC key only.
 *   - HmacSha256Signer (fallback): node:crypto HMAC-SHA256 over the same
 *                       payload - POSTURE DOWNGRADE, documented: symmetric, so
 *                       the verifying side needs the SAME secret key; use only
 *                       where the runtime's OpenSSL has no Ed25519 support.
 *
 * Key posture (SECURITY-MODEL section 3.3): the key belongs to the USER
 * keystore - never a Flauz service key. v0 ships FIXTURE keys (deterministic,
 * committed under test/fixtures/workflow/keys/) and a manifest-driven loader;
 * the real OS-backed keystore is product integration (REPORT GAPS-AND-SKIPS).
 * Nothing secret ever enters the ledger: the signature covers only
 * {rowSeq, headSha256}.
 */

import {
	createHash,
	createHmac,
	createPrivateKey,
	createPublicKey,
	sign as cryptoSign,
	verify as cryptoVerify,
	generateKeyPairSync,
	timingSafeEqual,
	type KeyObject,
} from 'node:crypto';
import type { CheckpointSigner } from '../../flauz-workspace/src/api.ts';
import { signedPayload } from '../../flauz-workspace/src/hardening.ts';

/** True when this runtime's OpenSSL supports Ed25519 (probed, not assumed). */
export function ed25519Supported(): boolean {
	try {
		generateKeyPairSync('ed25519');
		return true;
	} catch {
		return false;
	}
}

/** Ed25519 signer over fixture/user PEM key material (preferred posture). */
export function createEd25519Signer(keyId: string, privatePem: string, publicPem: string): CheckpointSigner {
	const privateKey: KeyObject = createPrivateKey(privatePem);
	const publicKey: KeyObject = createPublicKey(publicPem);
	return {
		algorithm: 'ed25519',
		keyId,
		sign: async (rowSeq: number, headSha256: string): Promise<string> =>
			Buffer.from(cryptoSign(null, Buffer.from(signedPayload(rowSeq, headSha256), 'utf8'), privateKey)).toString('hex'),
		verify: async (rowSeq: number, headSha256: string, signature: string): Promise<boolean> => {
			let sig: Buffer;
			try {
				sig = Buffer.from(signature, 'hex');
			} catch {
				return false;
			}
			return cryptoVerify(null, Buffer.from(signedPayload(rowSeq, headSha256), 'utf8'), publicKey, sig);
		},
	};
}

/** HMAC-SHA256 signer (documented posture downgrade - symmetric key). */
export function createHmacSha256Signer(keyId: string, keyHex: string): CheckpointSigner {
	const key = Buffer.from(keyHex, 'hex');
	const mac = (rowSeq: number, headSha256: string): Buffer => {
		const hmac = createHmac('sha256', key);
		hmac.update(signedPayload(rowSeq, headSha256), 'utf8');
		return Buffer.from(hmac.digest('hex'), 'hex');
	};
	return {
		algorithm: 'hmac-sha256',
		keyId,
		sign: async (rowSeq: number, headSha256: string): Promise<string> => mac(rowSeq, headSha256).toString('hex'),
		verify: async (rowSeq: number, headSha256: string, signature: string): Promise<boolean> => {
			let given: Buffer;
			try {
				given = Buffer.from(signature, 'hex');
			} catch {
				return false;
			}
			const expected = mac(rowSeq, headSha256);
			return given.length === expected.length && timingSafeEqual(given, expected);
		},
	};
}

// ---------------------------------------------------------------------------
// Fixture keystore (v0 stand-in for the real user keystore)
// ---------------------------------------------------------------------------

/** One entry of the keystore manifest (keys.json). */
export interface CheckpointKeyEntry {
	readonly algorithm: 'ed25519' | 'hmac-sha256';
	readonly keyId: string;
	readonly privateKeyFile?: string;
	readonly publicKeyFile?: string;
	readonly keyFile?: string;
}

export interface CheckpointKeystoreManifest {
	readonly active: string;
	readonly keys: readonly CheckpointKeyEntry[];
}

/** The keystore manifest file name inside a keystore directory. */
export const KEYSTORE_MANIFEST = 'keys.json';

function parseManifest(value: unknown): CheckpointKeystoreManifest {
	if (typeof value !== 'object' || value === null) {
		throw new Error('flauz keystore: manifest must be a JSON object');
	}
	const record = value as Record<string, unknown>;
	if (typeof record.active !== 'string' || record.active.length === 0) {
		throw new Error('flauz keystore: manifest.active must be a non-empty string');
	}
	if (!Array.isArray(record.keys)) {
		throw new Error('flauz keystore: manifest.keys must be an array');
	}
	const keys: CheckpointKeyEntry[] = record.keys.map((raw, index) => {
		if (typeof raw !== 'object' || raw === null) {
			throw new Error(`flauz keystore: manifest.keys[${String(index)}] must be an object`);
		}
		const entry = raw as Record<string, unknown>;
		if (entry.algorithm !== 'ed25519' && entry.algorithm !== 'hmac-sha256') {
			throw new Error(`flauz keystore: manifest.keys[${String(index)}].algorithm must be ed25519 or hmac-sha256`);
		}
		if (typeof entry.keyId !== 'string' || entry.keyId.length === 0) {
			throw new Error(`flauz keystore: manifest.keys[${String(index)}].keyId must be a non-empty string`);
		}
		if (entry.algorithm === 'ed25519' && (typeof entry.privateKeyFile !== 'string' || typeof entry.publicKeyFile !== 'string')) {
			throw new Error(`flauz keystore: ed25519 entry '${String(entry.keyId)}' needs privateKeyFile + publicKeyFile`);
		}
		if (entry.algorithm === 'hmac-sha256' && typeof entry.keyFile !== 'string') {
			throw new Error(`flauz keystore: hmac-sha256 entry '${String(entry.keyId)}' needs keyFile`);
		}
		return entry as unknown as CheckpointKeyEntry;
	});
	return { active: record.active, keys };
}

/**
 * Loads the ACTIVE signer from a keystore directory (keys.json + key files).
 * Returns undefined when the directory has no manifest (unhardened posture -
 * callers keep the v0 hash-chain-only behavior). Ed25519 is preferred; when
 * the runtime lacks Ed25519 support and an hmac-sha256 key is available, the
 * HMAC downgrade is selected (posture documented above).
 */
export async function loadCheckpointSigner(keystoreDir: string, readFile: (path: string) => Promise<string | undefined>, joinPathFn: (...parts: string[]) => string): Promise<CheckpointSigner | undefined> {
	const manifestRaw = await readFile(joinPathFn(keystoreDir, KEYSTORE_MANIFEST));
	if (manifestRaw === undefined) {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(manifestRaw);
	} catch (err) {
		throw new Error(`flauz keystore: ${KEYSTORE_MANIFEST} is not valid JSON: ${(err as Error).message}`);
	}
	const manifest = parseManifest(parsed);
	const active = manifest.keys.find(entry => entry.keyId === manifest.active);
	if (active === undefined) {
		throw new Error(`flauz keystore: active key '${manifest.active}' has no entry in manifest.keys`);
	}
	if (active.algorithm === 'ed25519' && ed25519Supported()) {
		const privatePem = await readFile(joinPathFn(keystoreDir, active.privateKeyFile ?? ''));
		const publicPem = await readFile(joinPathFn(keystoreDir, active.publicKeyFile ?? ''));
		if (privatePem === undefined || publicPem === undefined) {
			throw new Error(`flauz keystore: key files for '${active.keyId}' missing in ${keystoreDir}`);
		}
		return createEd25519Signer(active.keyId, privatePem, publicPem);
	}
	if (active.algorithm === 'ed25519') {
		const fallback = manifest.keys.find(entry => entry.algorithm === 'hmac-sha256');
		if (fallback === undefined) {
			throw new Error(`flauz keystore: active key '${active.keyId}' is ed25519 but this runtime lacks Ed25519 support and no hmac-sha256 fallback key exists`);
		}
		const keyHex = (await readFile(joinPathFn(keystoreDir, fallback.keyFile ?? '')))?.trim();
		if (keyHex === undefined || keyHex.length === 0) {
			throw new Error(`flauz keystore: hmac key file for '${fallback.keyId}' missing in ${keystoreDir}`);
		}
		return createHmacSha256Signer(fallback.keyId, keyHex);
	}
	const keyHex = (await readFile(joinPathFn(keystoreDir, active.keyFile ?? '')))?.trim();
	if (keyHex === undefined || keyHex.length === 0) {
		throw new Error(`flauz keystore: hmac key file for '${active.keyId}' missing in ${keystoreDir}`);
	}
	return createHmacSha256Signer(active.keyId, keyHex);
}

// ---------------------------------------------------------------------------
// Deterministic fixture generation (test/fixtures/workflow/keys)
// ---------------------------------------------------------------------------

/**
 * PKCS#8 DER prefix for an Ed25519 private key (RFC 5958 + RFC 8410):
 * the fixed 16-byte head in front of the 32-byte seed. Deriving the keypair
 * from a fixed seed keeps the committed fixtures byte-reproducible.
 */
const ED25519_PKCS8_PREFIX_HEX = '302e020100300506032b657004220420';

/** sha256-hex helper for seed derivation (node:crypto - this file is node-side by design). */

function sha256HexOf(input: string): string {
	return createHash('sha256').update(input, 'utf8').digest('hex');
}

export interface GeneratedFixtureKeystore {
	readonly manifest: CheckpointKeystoreManifest;
	readonly files: ReadonlyMap<string, string>;
}

/**
 * Deterministically derives the Lane K fixture keystore: an Ed25519 keypair
 * from sha256('flauz-fixture-ed25519-1') and an HMAC key from
 * sha256('flauz-fixture-hmac-1'). Byte-identical on every regeneration (the
 * committed fixtures under test/fixtures/workflow/keys/ are its output).
 */
export function generateFixtureKeystore(): GeneratedFixtureKeystore {
	const edSeed = sha256HexOf('flauz-fixture-ed25519-1');
	const der = Buffer.from(ED25519_PKCS8_PREFIX_HEX + edSeed, 'hex');
	const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
	const publicKey = createPublicKey(privateKey);
	const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
	const publicPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
	const hmacKeyHex = sha256HexOf('flauz-fixture-hmac-1');
	const manifest: CheckpointKeystoreManifest = {
		active: 'flauz-fixture-ed25519-1',
		keys: [
			{ algorithm: 'ed25519', keyId: 'flauz-fixture-ed25519-1', privateKeyFile: 'ed25519-private.pem', publicKeyFile: 'ed25519-public.pem' },
			{ algorithm: 'hmac-sha256', keyId: 'flauz-fixture-hmac-1', keyFile: 'hmac.key' },
		],
	};
	const files = new Map<string, string>();
	files.set(KEYSTORE_MANIFEST, `${JSON.stringify({ active: manifest.active, keys: manifest.keys }, null, '\t')}\n`);
	files.set('ed25519-private.pem', privatePem);
	files.set('ed25519-public.pem', publicPem);
	files.set('hmac.key', `${hmacKeyHex}\n`);
	return { manifest, files };
}

/**
 * Builds a signer directly from the in-memory fixture keystore (tests + the
 * fixture generator; no file IO). Ed25519 by default, HMAC downgrade on demand.
 */
export function createFixtureSigner(prefer: 'ed25519' | 'hmac-sha256' = 'ed25519'): CheckpointSigner {
	const keystore = generateFixtureKeystore();
	if (prefer === 'ed25519') {
		return createEd25519Signer('flauz-fixture-ed25519-1', keystore.files.get('ed25519-private.pem') ?? '', keystore.files.get('ed25519-public.pem') ?? '');
	}
	return createHmacSha256Signer('flauz-fixture-hmac-1', (keystore.files.get('hmac.key') ?? '').trim());
}
