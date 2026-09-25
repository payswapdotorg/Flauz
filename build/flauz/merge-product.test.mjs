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

	// DEVIATION NOTE (documented in build/flauz/README.md §Deviations): the work order
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
