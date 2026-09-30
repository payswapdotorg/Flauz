/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * P2-FIX-203 — the shipped Flauz guide's "Multi-agent work" section: the
 * delegation/A2A capability must be discoverable from an in-product surface
 * (the guide names `.flauz/a2a/contracts/`), with the DA22 keyboard contract
 * guarded as a regression.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const guide = readFileSync(fileURLToPath(new URL('../flauz-guide.md', import.meta.url)), 'utf-8');

test('P2-FIX-203: the shipped guide carries a Multi-agent work section naming .flauz/a2a/contracts/', () => {
	assert.match(guide, /^## Multi-agent work$/m);
	assert.match(guide, /\.flauz\/a2a\/contracts\//);
	assert.match(guide, /worker agents/);
	assert.match(guide, /delegate/i);
});

test('P2-FIX-203 regression (DA22): the guide still documents the standard tree keys and focus commands', () => {
	assert.match(guide, /Arrows, type-to-filter, Enter/);
	assert.match(guide, /Flauz: Focus/);
});
