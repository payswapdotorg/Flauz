/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The continuity adapter tests + the hand-off round-trip (export -> restore
 * with the bundle id surviving). Covers the export-point validation (id
 * grammar + existence + completeness), the restore-point validation (the
 * bundle must VERIFY + the target must be trusted -- fail-closed), the
 * SECRET-REDACTION law (redacted surfaces stay redacted; presence + path
 * hash only, never payloads).
 */
import { test } from 'node:test';
import { ok, strictEqual, throws } from 'node:assert';
import { ContinuityAdapter, parseBundleManifest, sha256Hex } from '../../src/resourceExec/continuity.ts';
import { TaskResourceError } from '../../src/resourceExec/types.ts';
import { copyGoodWorkspace } from './helpers.ts';

test('validateExportPoint: a complete bundle returns the manifest (the export-point is valid)', async () => {
	const { root, fs, cleanup } = await copyGoodWorkspace();
	try {
		const adapter = new ContinuityAdapter({ workspaceRoot: root, fs });
		const result = await adapter.validateExportPoint('flauz:continuity:0123456789abcdef');
		ok(result.ok);
		strictEqual(result.manifest.bundleId, 'flauz:continuity:0123456789abcdef');
	} finally {
		await cleanup();
	}
});

test('validateExportPoint: CONTINUITY_INVALID -- a malformed bundle id (never a path, never a URL)', async () => {
	const { root, fs, cleanup } = await copyGoodWorkspace();
	try {
		const adapter = new ContinuityAdapter({ workspaceRoot: root, fs });
		const result = await adapter.validateExportPoint('not-a-bundle-id');
		ok(!result.ok);
		strictEqual(result.error.code, 'CONTINUITY_INVALID');
		ok(/never paths, never URLs/.test(result.error.message));
	} finally {
		await cleanup();
	}
});

test('validateExportPoint: CONTINUITY_INVALID -- a bundle that does not exist on disk', async () => {
	const { root, fs, cleanup } = await copyGoodWorkspace();
	try {
		const adapter = new ContinuityAdapter({ workspaceRoot: root, fs });
		const result = await adapter.validateExportPoint('flauz:continuity:9999999999999999');
		ok(!result.ok);
		strictEqual(result.error.code, 'CONTINUITY_INVALID');
		ok(/not found/.test(result.error.message));
	} finally {
		await cleanup();
	}
});

test('validateRestorePoint: a complete bundle + a trusted target returns the manifest + the surface counts', async () => {
	const { root, fs, cleanup } = await copyGoodWorkspace();
	try {
		const adapter = new ContinuityAdapter({ workspaceRoot: root, fs });
		const result = await adapter.validateRestorePoint('flauz:continuity:0123456789abcdef', true);
		ok(result.ok);
		strictEqual(result.manifest.bundleId, 'flauz:continuity:0123456789abcdef');
		strictEqual(result.surfacesCarried, 4);
		strictEqual(result.surfacesLost, 1);
		strictEqual(result.surfacesRedacted, 1);
	} finally {
		await cleanup();
	}
});

test('validateRestorePoint: CONTINUITY_INVALID -- a non-trusted target (the fail-closed gate belongs to the TL3 manager; the adapter enforces the SAME verdict)', async () => {
	const { root, fs, cleanup } = await copyGoodWorkspace();
	try {
		const adapter = new ContinuityAdapter({ workspaceRoot: root, fs });
		const result = await adapter.validateRestorePoint('flauz:continuity:0123456789abcdef', false);
		ok(!result.ok);
		strictEqual(result.error.code, 'CONTINUITY_INVALID');
		ok(/not trusted/.test(result.error.message));
		ok(/fail-closed gate belongs to the TL3 manager/.test(result.error.message));
	} finally {
		await cleanup();
	}
});

test('validateRestorePoint: CONTINUITY_INVALID -- a missing bundle', async () => {
	const { root, fs, cleanup } = await copyGoodWorkspace();
	try {
		const adapter = new ContinuityAdapter({ workspaceRoot: root, fs });
		const result = await adapter.validateRestorePoint('flauz:continuity:9999999999999999', true);
		ok(!result.ok);
		strictEqual(result.error.code, 'CONTINUITY_INVALID');
		ok(/not found/.test(result.error.message));
	} finally {
		await cleanup();
	}
});

test('SECRET-REDACTION: the redacted surface sha256 is the sha256 of the PATH (re-derivable; the payload is NEVER copied into the bundle)', async () => {
	const { root, fs, cleanup } = await copyGoodWorkspace();
	try {
		const adapter = new ContinuityAdapter({ workspaceRoot: root, fs });
		const manifest = await adapter.loadManifest('flauz:continuity:0123456789abcdef');
		ok(manifest !== undefined);
		const redacted = manifest!.surfaces['flauz-evidence-ledger'];
		ok(redacted !== undefined);
		strictEqual(redacted!.status, 'redacted');
		strictEqual(redacted!.sha256, sha256Hex('.flauz/evidence/ledger.jsonl'));
		strictEqual(redacted!.artifactPath, undefined, 'a redacted surface has NO artifact path -- the payload is never copied');
		strictEqual(redacted!.bytes, undefined, 'a redacted surface has NO bytes field');
	} finally {
		await cleanup();
	}
});

test('sha256Hex: matches the canonical sha256 of an empty string (cross-check the pure-TS impl against the known digest)', () => {
	strictEqual(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
	strictEqual(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('parseBundleManifest: rejects a manifest missing a required field', () => {
	const bad = {
		schemaVersion: 0,
		schema: 'flauz.continuity-bundle/v0',
		bundleId: 'flauz:continuity:0123456789abcdef',
		createdAt: 1760000100000,
		actor: 'human',
		// surfaces: missing
	};
	throws(
		() => parseBundleManifest(JSON.stringify(bad)),
		(err: unknown) => err instanceof TaskResourceError && err.code === 'OP_INVALID' && /surfaces/.test(err.message),
	);
});

test('parseBundleManifest: rejects a manifest with an unknown surface status', () => {
	const bad = {
		schemaVersion: 0,
		schema: 'flauz.continuity-bundle/v0',
		bundleId: 'flauz:continuity:0123456789abcdef',
		createdAt: 1760000100000,
		actor: 'human',
		surfaces: {
			'scm-working-tree': { status: 'unknown' },
		},
	};
	throws(
		() => parseBundleManifest(JSON.stringify(bad)),
		(err: unknown) => err instanceof TaskResourceError && err.code === 'OP_INVALID' && /status must be one of/.test(err.message),
	);
});

test('parseBundleManifest: rejects a redacted surface carrying bytes (the payload is NEVER copied)', () => {
	const bad = {
		schemaVersion: 0,
		schema: 'flauz.continuity-bundle/v0',
		bundleId: 'flauz:continuity:0123456789abcdef',
		createdAt: 1760000100000,
		actor: 'human',
		surfaces: {
			'flauz-evidence-ledger': {
				status: 'redacted',
				sha256: sha256Hex('.flauz/evidence/ledger.jsonl'),
				note: 'redacted',
				bytes: 42, // forbidden for redacted
			},
		},
	};
	throws(
		() => parseBundleManifest(JSON.stringify(bad)),
		(err: unknown) => err instanceof TaskResourceError && err.code === 'OP_INVALID' && /redacted entries must not carry artifactPath\/bytes/.test(err.message),
	);
});

test('parseBundleManifest: rejects a lost surface carrying artifact/sha256/bytes (lost entries carry nothing but the note)', () => {
	const bad = {
		schemaVersion: 0,
		schema: 'flauz.continuity-bundle/v0',
		bundleId: 'flauz:continuity:0123456789abcdef',
		createdAt: 1760000100000,
		actor: 'human',
		surfaces: {
			'scm-working-tree': {
				status: 'lost',
				artifactPath: 'should-not-be-here',
				note: 'lost',
			},
		},
	};
	throws(
		() => parseBundleManifest(JSON.stringify(bad)),
		(err: unknown) => err instanceof TaskResourceError && err.code === 'OP_INVALID' && /lost entries must not carry artifact\/sha256\/bytes/.test(err.message),
	);
});

test('parseBundleManifest: rejects a lost surface without a note (lost entries require the why-note)', () => {
	const bad = {
		schemaVersion: 0,
		schema: 'flauz.continuity-bundle/v0',
		bundleId: 'flauz:continuity:0123456789abcdef',
		createdAt: 1760000100000,
		actor: 'human',
		surfaces: {
			'scm-working-tree': { status: 'lost' },
		},
	};
	throws(
		() => parseBundleManifest(JSON.stringify(bad)),
		(err: unknown) => err instanceof TaskResourceError && err.code === 'OP_INVALID' && /lost entries require a note/.test(err.message),
	);
});

test('parseBundleManifest: rejects a carried surface without artifact fields', () => {
	const bad = {
		schemaVersion: 0,
		schema: 'flauz.continuity-bundle/v0',
		bundleId: 'flauz:continuity:0123456789abcdef',
		createdAt: 1760000100000,
		actor: 'human',
		surfaces: {
			'flauz-tasks-envelope': { status: 'carried', note: 'incomplete' },
		},
	};
	throws(
		() => parseBundleManifest(JSON.stringify(bad)),
		(err: unknown) => err instanceof TaskResourceError && err.code === 'OP_INVALID' && /carried entries require artifactPath/.test(err.message),
	);
});

// ---------------------------------------------------------------------------
// The hand-off round-trip (export -> restore with the bundle id surviving)
// ---------------------------------------------------------------------------

test('hand-off round-trip: export (validate the bundle) -> restore (re-validate; the bundle id survives)', async () => {
	const { root, fs, cleanup } = await copyGoodWorkspace();
	try {
		const adapter = new ContinuityAdapter({ workspaceRoot: root, fs });

		// export-point: validate the bundle
		const exportResult = await adapter.validateExportPoint('flauz:continuity:0123456789abcdef');
		ok(exportResult.ok);
		const exportedBundleId = exportResult.manifest.bundleId;

		// restore-point: re-validate the SAME bundle id (it must survive)
		const restoreResult = await adapter.validateRestorePoint(exportedBundleId, true);
		ok(restoreResult.ok);
		strictEqual(restoreResult.manifest.bundleId, exportedBundleId, 'the bundle id survives the export -> restore round-trip');

		// the surface counts must be identical (no loss between export and restore)
		strictEqual(restoreResult.surfacesCarried, 4);
		strictEqual(restoreResult.surfacesRedacted, 1);
		strictEqual(restoreResult.surfacesLost, 1);
	} finally {
		await cleanup();
	}
});

test('hand-off round-trip: restore fails closed when the bundle is missing', async () => {
	const { root, fs, cleanup } = await copyGoodWorkspace();
	try {
		const adapter = new ContinuityAdapter({ workspaceRoot: root, fs });
		const result = await adapter.validateRestorePoint('flauz:continuity:9999999999999999', true);
		ok(!result.ok);
		strictEqual(result.error.code, 'CONTINUITY_INVALID');
	} finally {
		await cleanup();
	}
});
