/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Tests for build/flauz/merge-product.mjs (Wave 3 Lane F, task W3-F-R-b).
//
// Run with:
//   node --test /home/z/my-project/Flauz/build/flauz/merge-product.test.mjs
//
// Exactly 5 tests, one per work-order requirement. Test 4 pins the ACTUAL
// in-tree posture of the upstream base product.json @ 9bf9ae764da (see the
// note inside that test for the extensionsGallery deviation).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeProduct, serializeProduct } from './merge-product.mjs';

// Repo root (two levels up from build/flauz/).
const repoRoot = join(import.meta.dirname, '..', '..');
const realProductPath = join(repoRoot, 'product.json');

test('overlay-wins: scalar overlay value replaces base value, unrelated base keys are kept', () => {
	const base = { a: 1, nameShort: 'Code - OSS' };
	const overlay = { nameShort: 'Flauz' };
	const merged = mergeProduct(base, overlay);

	assert.equal(merged.nameShort, 'Flauz', 'overlay nameShort must win');
	assert.equal(merged.a, 1, 'base-only key must be kept');
	assert.equal(base.nameShort, 'Code - OSS', 'merge must not mutate the base');
});

test('null-deletes: explicit null in the overlay DELETES the key from the merged result', () => {
	const base = { defaultChatAgent: { extensionId: 'GitHub.copilot' }, nameShort: 'x' };
	const overlay = { defaultChatAgent: null };
	const merged = mergeProduct(base, overlay);

	assert.equal('defaultChatAgent' in merged, false, 'defaultChatAgent must be deleted');
	assert.equal(merged.nameShort, 'x', 'other keys survive the deletion');
	assert.deepEqual(base.defaultChatAgent, { extensionId: 'GitHub.copilot' }, 'merge must not mutate the base');
});

test('nested-merge: plain objects merge recursively (both keys kept), sibling base keys kept', () => {
	const base = { extensionEnabledApiProposals: { 'other.ext': ['x'] }, k: 1 };
	const overlay = { extensionEnabledApiProposals: { 'flauz.flauz-agent': ['defaultChatParticipant'] } };
	const merged = mergeProduct(base, overlay);

	assert.deepEqual(
		merged.extensionEnabledApiProposals,
		{ 'other.ext': ['x'], 'flauz.flauz-agent': ['defaultChatParticipant'] },
		'nested object must merge recursively, not replace wholesale'
	);
	assert.equal(merged.k, 1, 'sibling base key must be kept');
});

test('real-product-pass-through: merging the real upstream product.json keeps base identity/gallery posture/built-ins', () => {
	const base = JSON.parse(readFileSync(realProductPath, 'utf8'));

	// The real base must carry the Copilot default-agent block that the v0 overlay deletes.
	assert.equal('defaultChatAgent' in base, true, 'real base product.json must have a defaultChatAgent key (product.json:90-157)');
	assert.equal(base.defaultChatAgent.extensionId, 'GitHub.copilot');

	// DEVIATION NOTE (documented in build/flauz/README.md section Deviations): the work order
	// expected the base to also have an extensionsGallery key, but the verified in-tree
	// evidence (worklog W3-F-r1: "no version/identifier/quality/extensionsGallery/
	// extensionEnabledApiProposals keys"; direct enumeration: 46 top-level keys) shows the
	// upstream product.json @ 9bf9ae764da ships WITHOUT a gallery. We therefore pin the
	// ACTUAL v0 posture here: no gallery in the base => no gallery in the merged product
	// (the v0 overlay neither sets nor strips it). If the base ever gains a gallery, this
	// assertion failing is the tripwire to re-check canary item D4 applicability.
	assert.equal('extensionsGallery' in base, false, 'base @ 9bf9ae764da has no extensionsGallery key (worklog W3-F-r1)');

	const merged = mergeProduct(base, { nameShort: 'Flauz' });

	assert.equal(merged.nameShort, 'Flauz', 'overlay nameShort must replace the base value');
	assert.equal(merged.nameLong, base.nameLong, 'base nameLong must be kept');
	assert.deepEqual(merged.builtInExtensions, base.builtInExtensions, 'base builtInExtensions must be kept');
	assert.deepEqual(merged.extensionsGallery, base.extensionsGallery, 'gallery posture must be preserved exactly (absent in v0 base)');
	assert.equal('defaultChatAgent' in merged, true, 'a minimal overlay without defaultChatAgent:null must NOT delete the base key');
});

test('validation-and-format: invalid extensionEnabledApiProposals throws; valid merges serialize with TAB indent + trailing newline', () => {
	// Invalid: proposal value must be an array of strings.
	assert.throws(
		() => mergeProduct({}, { extensionEnabledApiProposals: { 'x.y': 'not-an-array' } }),
		/extensionEnabledApiProposals.*must be an array of strings/
	);

	// Valid merge formats exactly like the upstream product.json.
	const merged = mergeProduct({ nameShort: 'Code - OSS', nameLong: 'Code - OSS' }, { nameShort: 'Flauz' });
	const serialized = serializeProduct(merged);

	assert.ok(serialized.endsWith('}\n'), 'output must end with } followed by a trailing newline');
	assert.ok(serialized.includes('\n\t"nameShort"'), 'output must use TAB indentation');
	assert.deepEqual(JSON.parse(serialized), merged, 'round-trip must be lossless');
});

// ---------------------------------------------------------------------------
// TL1-002 additions (overlay surface grew: rebrand set + Copilot-residue cleanup).
// The five tests above are untouched; these extend the suite additively.
// ---------------------------------------------------------------------------

test('tl1-002 real overlay: validates and lands the full rebrand + Copilot cleanup on the real base', () => {
	const base = JSON.parse(readFileSync(realProductPath, 'utf8'));
	const overlayPath = join(repoRoot, 'product.flauz.json');
	const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
	const merged = mergeProduct(base, overlay, { overlayName: 'product.flauz.json' });

	// identity rebrand landed
	assert.equal(merged.nameShort, 'Flauz');
	assert.equal(merged.nameLong, 'Flauz');
	assert.equal(merged.applicationName, 'flauz');
	assert.equal(merged.dataFolderName, '.flauz');
	assert.equal(merged.win32DirName, 'Flauz');
	assert.equal(merged.darwinBundleIdentifier, 'flauz.flauz');
	assert.equal(merged.urlProtocol, 'flauz');
	assert.equal(merged.reportIssueUrl, 'https://github.com/payswapdotorg/Flauz/issues/new');

	// Copilot removal: null-delete + residue cleanup
	assert.equal('defaultChatAgent' in merged, false, 'defaultChatAgent must be null-deleted');
	assert.deepEqual(merged.builtInExtensionsEnabledWithAutoUpdates, [], 'copilot-chat auto-update residue must clear to [] (never null — scanner crash)');
	assert.deepEqual(merged.trustedExtensionAuthAccess, { microsoft: ['vscode.github-authentication'] }, 'github/github-enterprise copilot grants null-deleted; functional microsoft grant kept');

	// audited proposal posture (manifests: browser [browser], workspace [scmArtifactProvider], agent [] + documented DL-4 grant)
	assert.deepEqual(
		merged.extensionEnabledApiProposals,
		{
			'flauz.flauz-agent': ['defaultChatParticipant', 'chatParticipantAdditions'],
			'flauz.flauz-workspace': ['scmArtifactProvider'],
			'flauz.flauz-browser': ['browser'],
		}
	);
});

test('tl1-002 null-delete trap: builtInExtensionsEnabledWithAutoUpdates null THROWS (scanner crash), [] passes', () => {
	// null would delete the key -> extensionsScannerService.ts:113 iterates undefined -> crash.
	assert.throws(
		() => mergeProduct({ builtInExtensionsEnabledWithAutoUpdates: ['GitHub.copilot-chat'] }, { builtInExtensionsEnabledWithAutoUpdates: null }),
		/builtInExtensionsEnabledWithAutoUpdates.*must NOT be null.*CRASH the scanner/
	);
	// [] is the safe residue cleanup and replaces the base value wholesale.
	const merged = mergeProduct({ builtInExtensionsEnabledWithAutoUpdates: ['GitHub.copilot-chat'] }, { builtInExtensionsEnabledWithAutoUpdates: [] });
	assert.deepEqual(merged.builtInExtensionsEnabledWithAutoUpdates, []);
});

test('tl1-002 trustedExtensionAuthAccess: nested null-deletes per provider; malformed grants throw', () => {
	const base = { trustedExtensionAuthAccess: { github: ['GitHub.copilot-chat'], 'github-enterprise': ['GitHub.copilot-chat'], microsoft: ['vscode.github-authentication'] } };

	// surgical nested null-delete removes only the copilot grants
	const merged = mergeProduct(base, { trustedExtensionAuthAccess: { github: null, 'github-enterprise': null } });
	assert.deepEqual(merged.trustedExtensionAuthAccess, { microsoft: ['vscode.github-authentication'] });

	// malformed: grant list must be null or an array of strings
	assert.throws(
		() => mergeProduct({}, { trustedExtensionAuthAccess: { github: 'not-a-list' } }),
		/trustedExtensionAuthAccess.*github.*must be null.*or an array of extension-id strings/
	);
});
