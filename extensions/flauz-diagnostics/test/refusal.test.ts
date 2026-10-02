/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W1 -- the REFUSAL classes: the privacy gate's typed errors.
 *
 *   - `contents` is REFUSED in v0: the typed error names the class, the
 *     privacy law and the full future-decision list; NO bundle directory is
 *     created (the refusal is decided before any fs effect).
 *   - unknown classes are refused with the valid-class list.
 *   - include subsets work (the manifest always rides along).
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';

import { CONTENTS_FUTURE_DECISIONS, DiagnosticsError } from '../src/api.ts';
import { createSupportBundle, resolveInclude } from '../src/bundle.ts';
import { bootFixtureWorkspace, listBundleDirs, type FixtureWorkspace } from './helpers.ts';

suite('refusals: the privacy gate', () => {
	let fixture: FixtureWorkspace;

	suiteSetup(async () => {
		fixture = await bootFixtureWorkspace();
	});

	suiteTeardown(async () => {
		await fixture.cleanup();
	});

	test('the contents class is refused with the typed error carrying the future-decision list', () => {
		assert.throws(
			() => resolveInclude(['contents']),
			(err: unknown) => {
				assert.ok(err instanceof DiagnosticsError);
				assert.strictEqual(err.code, 'FLAUZ_DIAG_CONTENTS_REFUSED');
				assert.match(err.message, /'contents' class is REFUSED/);
				for (const decision of CONTENTS_FUTURE_DECISIONS) {
					assert.ok(err.message.includes(decision), `the refusal surfaces the future decision: ${String(decision.slice(0, 40))}...`);
				}
				return true;
			},
		);
		// mixed lists refuse on the contents entry, not silently skip it
		assert.throws(() => resolveInclude(['diagnostics', 'contents']), (err: unknown) => {
			assert.ok(err instanceof DiagnosticsError && err.code === 'FLAUZ_DIAG_CONTENTS_REFUSED');
			return true;
		});
	});

	test('a contents refusal creates NO bundle directory (the refusal precedes every fs effect)', async () => {
		const before = await listBundleDirs(fixture.root);
		await assert.rejects(
			createSupportBundle({
				root: fixture.root,
				fs: fixture.fs,
				clock: fixture.clock,
				versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] },
				environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
			}, ['contents']),
			(err: unknown) => {
				assert.ok(err instanceof DiagnosticsError && err.code === 'FLAUZ_DIAG_CONTENTS_REFUSED');
				return true;
			},
		);
		const after = await listBundleDirs(fixture.root);
		assert.deepStrictEqual(after, before, 'no bundle directory was created by the refusal');
	});

	test('unknown classes are refused with the valid-class list', () => {
		assert.throws(() => resolveInclude(['diagnostics', 'workspace-dump']), (err: unknown) => {
			assert.ok(err instanceof DiagnosticsError);
			assert.strictEqual(err.code, 'FLAUZ_DIAG_UNKNOWN_CLASS');
			assert.match(err.message, /unknown include class 'workspace-dump'/);
			assert.match(err.message, /valid: manifest, diagnostics, provider-lanes, recent-events, integrity/);
			return true;
		});
		assert.throws(() => resolveInclude([]), (err: unknown) => {
			// an empty include list is NOT the default: nothing selected is a user error
			assert.ok(err instanceof DiagnosticsError);
			return true;
		});
	});

	test('an include subset produces exactly the selected classes + the manifest', async () => {
		const result = await createSupportBundle({
			root: fixture.root,
			fs: fixture.fs,
			clock: fixture.clock,
			versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] },
			environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
		}, ['diagnostics', 'integrity']);
		const names = result.files.map(file => file.file).sort();
		assert.deepStrictEqual(names, ['MANIFEST.json', 'diagnostics.json', 'integrity.json']);
		const dirEntries = (await fs.readdir(result.bundleDir)).sort();
		assert.deepStrictEqual(dirEntries, ['MANIFEST.json', 'diagnostics.json', 'integrity.json']);
		const manifest = JSON.parse(await fs.readFile(`${String(result.bundleDir)}/MANIFEST.json`, 'utf-8')) as { include: string[]; artifactClasses: Array<{ artifactClass: string }> };
		assert.deepStrictEqual(manifest.include, ['diagnostics', 'integrity'], 'the manifest records the include set');
		assert.deepStrictEqual(manifest.artifactClasses.map(entry => entry.artifactClass).sort(), ['diagnostics', 'integrity', 'manifest'], 'the manifest enumerates only what shipped');
	});
});
