/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The DL-32 contract pins (A-PROD-005-W1): this extension's
 * contract-duplicated shapes pinned against the REAL owning modules
 * (test-time cross-extension imports are the sanctioned session-battery
 * pattern; src never crosses extension boundaries).
 *
 *   - productState.ts  vs extensions/flauz-release/src/productState.ts (THE
 *     SEAM this wave drives: same fixture root -> same summaries, same lint
 *     reasons, same expected names);
 *   - api.ts           vs extensions/flauz-release/src/api.ts (sha256
 *     byte-equal vs node:crypto; canonical JSON + artifact serialization
 *     byte-equal; the SURFACES registry identical);
 *   - verify.ts        vs extensions/flauz-release/src/verify.ts (the row
 *     parsers + chain hashes agree on valid + invalid inputs);
 *   - banking.ts       vs the flauz-release parseLedgerLine (a banked
 *     production row parses under the REAL owning parser -- the
 *     cross-recognition law);
 *   - capabilities.ts  vs the LIVE repo manifests (the catalog claims the
 *     real command surface exactly -- the drift protection the matrix
 *     derives from).
 */

import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { suite, test } from 'mocha';

import { sha256Hex, canonicalJson, serializeArtifact, SURFACES, joinPath } from '../src/api.ts';
import { activationLintReasons, expectedExtensionNames, readProductState, isProductRoot, postureDriftReasons } from '../src/productState.ts';
import { ledgerRowHash, ledgerHeadHash, parseLedgerLine, parseOpsLine, ledgerRowLine } from '../src/verify.ts';
import { bankLedgerRowFor } from '../src/banking.ts';
import { CAPABILITY_CATALOG, catalogClosure } from '../src/capabilities.ts';

import { sha256Hex as releaseSha256Hex, canonicalJson as releaseCanonicalJson, serializeArtifact as releaseSerializeArtifact, SURFACES as RELEASE_SURFACES } from '../../flauz-release/src/api.ts';
import { activationLintReasons as releaseActivationLintReasons, expectedExtensionNames as releaseExpectedExtensionNames, readProductState as releaseReadProductState, isProductRoot as releaseIsProductRoot } from '../../flauz-release/src/productState.ts';
import { parseLedgerLine as releaseParseLedgerLine, parseOpsLine as releaseParseOpsLine, ledgerRowHash as releaseLedgerRowHash } from '../../flauz-release/src/verify.ts';

import { nodeProductionFs, steppingClock, repoRoot, bootFixtureProduct, bootFixtureWorkspace } from './helpers.ts';
import * as nodeFs from 'node:fs/promises';

const fs = nodeProductionFs();
const clock = steppingClock();

suite('A-PROD-005-W1 contract pins: api.ts vs the W5 owning module', () => {
        test('sha256Hex is byte-equal to node:crypto and to the W5 flauz-release implementation', () => {
                const payloads = ['', 'flauz', '{"a":1,"b":[2,3]}', 'x'.repeat(1000), 'ünïcödé ✓ snowman ☃'];
                for (const payload of payloads) {
                        const expected = createHash('sha256').update(payload, 'utf8').digest('hex');
                        assert.equal(sha256Hex(payload), expected);
                        assert.equal(sha256Hex(payload), releaseSha256Hex(payload));
                }
        });

        test('canonicalJson + serializeArtifact are byte-equal to the W5 implementation', () => {
                const values = [
                        { b: 1, a: [2, { z: null, y: undefined, w: 's' }] },
                        { rows: [{ seq: 1, ts: 2, taskId: 't', kind: 'note', uri: 'u', sha256: 'a'.repeat(64), prev: null }] },
                        [],
                        'plain',
                ];
                for (const value of values) {
                        assert.equal(canonicalJson(value), releaseCanonicalJson(value));
                        assert.equal(serializeArtifact(value), releaseSerializeArtifact(value));
                }
        });

        test('the SURFACES registry is identical to the W5 registry (ids + files + format versions)', () => {
                assert.equal(SURFACES.length, RELEASE_SURFACES.length);
                for (const [index, surface] of SURFACES.entries()) {
                        const owning = RELEASE_SURFACES[index];
                        assert.ok(owning !== undefined);
                        assert.equal(surface.id, owning.id);
                        assert.equal(surface.formatVersion, owning.formatVersion);
                        assert.deepEqual(surface.fixedFiles, owning.fixedFiles);
                }
        });
});

suite('A-PROD-005-W1 contract pins: productState.ts vs the W5 SEAM (the designed seam this wave drives)', () => {
        test('isProductRoot agrees with the W5 probe on the real repo root and on a non-product root', async () => {
                assert.equal(await isProductRoot(repoRoot, fs), true);
                assert.equal(await releaseIsProductRoot(repoRoot, fs), true);
                const workspace = await bootFixtureWorkspace();
                try {
                        assert.equal(await isProductRoot(workspace.root, fs), false);
                        assert.equal(await releaseIsProductRoot(workspace.root, fs), false);
                } finally {
                        await workspace.cleanup();
                }
        });

        test('readProductState derives the SAME summaries as the W5 reader over a shared fixture root (the commands field extends, never alters)', async () => {
                const product = await bootFixtureProduct();
                try {
                        const mine = await readProductState(product.root, fs);
                        const owning = await releaseReadProductState(product.root, fs);
                        assert.ok(mine !== undefined && owning !== undefined);
                        assert.equal(mine.extensions.length, owning.extensions.length);
                        for (const [index, extension] of mine.extensions.entries()) {
                                const other = owning.extensions[index];
                                assert.ok(other !== undefined);
                                assert.equal(extension.name, other.name);
                                assert.equal(extension.manifestPath, other.manifestPath);
                                assert.equal(extension.manifestPresent, other.manifestPresent);
                                assert.equal(extension.parseError, other.parseError);
                                assert.equal(extension.publisher, other.publisher);
                                assert.equal(extension.version, other.version);
                                assert.equal(extension.main, other.main);
                                assert.equal(extension.browser, other.browser);
                                assert.deepEqual(extension.activationEvents, other.activationEvents);
                                assert.equal(extension.id, other.id);
                        }
                        assert.equal(mine.parity.rowCount, owning.parity.rowCount);
                        assert.deepEqual(mine.parity.extensionSurfaces, owning.parity.extensionSurfaces);
                        assert.equal(mine.sbom.componentCount, owning.sbom.componentCount);
                        assert.deepEqual(mine.sbom.extensionComponents.map(component => component.name), owning.sbom.extensionComponents.map(component => component.name));
                        assert.deepEqual(expectedExtensionNames(mine), releaseExpectedExtensionNames(owning));
                } finally {
                        await product.cleanup();
                }
        });

        test('activationLintReasons agrees with the W5 mirror over a battery of manifests (the R1-R3 + id/entrypoint laws)', async () => {
                const product = await bootFixtureProduct();
                try {
                        const mine = await readProductState(product.root, fs);
                        const owning = await releaseReadProductState(product.root, fs);
                        assert.ok(mine !== undefined && owning !== undefined);
                        for (const [index, extension] of mine.extensions.entries()) {
                                const summary = { ...extension, commands: [] };
                                const owningSummary = owning.extensions[index];
                                assert.ok(owningSummary !== undefined);
                                // the W5 mirror's summary shape has no commands field; the laws consume the shared fields only
                                assert.deepEqual(activationLintReasons(summary), releaseActivationLintReasons(owningSummary));
                        }
                        // a wildcard manifest flags identically
                        const wildcard = { extensionDir: 'extensions/flauz-x', manifestPath: 'extensions/flauz-x/package.json', name: 'flauz-x', manifestPresent: true, publisher: 'flauz', main: './dist/extension.js', activationEvents: ['*'], commands: [], id: 'flauz.flauz-x' };
                        assert.deepEqual(activationLintReasons(wildcard), releaseActivationLintReasons(wildcard));
                        // a foreign publisher flags identically
                        const foreign = { extensionDir: 'extensions/flauz-x', manifestPath: 'extensions/flauz-x/package.json', name: 'flauz-x', manifestPresent: true, publisher: 'other', main: './dist/extension.js', activationEvents: [], commands: [] };
                        assert.deepEqual(activationLintReasons(foreign), releaseActivationLintReasons(foreign));
                } finally {
                        await product.cleanup();
                }
        });

        test('postureDriftReasons fires exactly on the PP4 drift class', () => {
                const manifest = { extensionDir: 'extensions/flauz-beta', manifestPath: 'extensions/flauz-beta/package.json', name: 'flauz-beta', manifestPresent: true, publisher: 'flauz', main: './dist/extension.js', activationEvents: [], commands: [] };
                assert.deepEqual(postureDriftReasons(manifest, [{ class: 'web-blocked' }]), [], 'main-only + web-blocked re-derives');
                assert.equal(postureDriftReasons(manifest, [{ class: 'web-full' }]).length, 1, 'main-only + web-full is drift');
                const browsery = { ...manifest, browser: './dist/web.js' };
                assert.deepEqual(postureDriftReasons(browsery, [{ class: 'web-full' }]), [], 'browser-carrying + web-full re-derives');
                assert.equal(postureDriftReasons(browsery, [{ class: 'web-blocked' }]).length, 1, 'browser-carrying + web-blocked is drift');
        });
});

suite('A-PROD-005-W1 contract pins: verify.ts + banking.ts vs the W5 owning modules', () => {
        test('parseLedgerLine + parseOpsLine agree on valid and invalid inputs', () => {
                const validLedger = '{"kind":"note","prev":null,"seq":1,"sha256":"' + 'a'.repeat(64) + '","taskId":"t","ts":100,"uri":"u"}';
                const mine = parseLedgerLine(validLedger, 1);
                const owning = releaseParseLedgerLine(validLedger, 1);
                assert.equal(mine.ok, owning.ok);
                assert.equal(mine.ok, true);
                if (mine.ok && owning.ok) {
                        assert.equal(ledgerRowHash(mine.row), releaseLedgerRowHash(owning.row));
                }
                for (const bad of ['', '{', '[]', '{"seq":0}', `{"kind":"note","prev":null,"seq":1,"sha256":"short","taskId":"t","ts":100,"uri":"u"}`]) {
                        assert.equal(parseLedgerLine(bad, 1).ok, false);
                        assert.equal(parseLedgerLine(bad, 1).ok, releaseParseLedgerLine(bad, 1).ok);
                }
                const validOps = '{"actor":"tool","afterDigest":"' + 'b'.repeat(64) + '","beforeDigest":"' + 'c'.repeat(64) + '","op":"add-ref","prev":null,"refId":"r","seq":1,"ts":100}';
                assert.equal(parseOpsLine(validOps, 1).ok, true);
                assert.equal(parseOpsLine(validOps, 1).ok, releaseParseOpsLine(validOps, 1).ok);
                for (const bad of ['', '{', '{"actor":"nope"}']) {
                        assert.equal(parseOpsLine(bad, 1).ok, false);
                        assert.equal(parseOpsLine(bad, 1).ok, releaseParseOpsLine(bad, 1).ok);
                }
        });

        test('the empty-ledger + multi-row chain-head conventions agree', () => {
                assert.equal(ledgerHeadHash([]), sha256Hex(''));
                const rows = [
                        { seq: 1, ts: 100, taskId: 't', kind: 'note', uri: 'u1', sha256: 'a'.repeat(64), prev: null },
                        { seq: 2, ts: 200, taskId: 't', kind: 'note', uri: 'u2', sha256: 'b'.repeat(64), prev: null },
                ];
                assert.equal(ledgerHeadHash(rows), ledgerRowHash(rows[1] as (typeof rows)[number]));
        });

        test('a banked production row parses under the REAL W5 parser (the cross-recognition law)', async () => {
                const workspace = await bootFixtureWorkspace();
                try {
                        const recordLine = '{"$schema":"flauz.production-census/v1","ok":true}';
                        const banking = await bankLedgerRowFor({ root: workspace.root, fs, clock }, recordLine, '.flauz/production/census-fixture.json');
                        assert.equal(banking.recordAppended, true);
                        const text = await nodeFs.readFile(`${workspace.root}/.flauz/evidence/ledger.jsonl`, 'utf-8');
                        const lines = text.split('\n').filter(line => line !== '');
                        assert.equal(lines.length, 1);
                        // the row parses under THIS extension's parser AND the W5 owning parser
                        const mine = parseLedgerLine(lines[0] as string, 1);
                        const owning = releaseParseLedgerLine(lines[0] as string, 1);
                        assert.equal(mine.ok, true);
                        assert.equal(owning.ok, true, `the W5 parser accepts the banked row (${lines[0]})`);
                        if (mine.ok) {
                                assert.equal(mine.row.taskId, 'flauz-production');
                                assert.equal(mine.row.uri, '.flauz/production/census-fixture.json');
                                // the canonical line round-trips (the row hash input is stable)
                                assert.equal(ledgerRowLine(mine.row), lines[0]);
                        }
                } finally {
                        await workspace.cleanup();
                }
        });
});

suite('A-PROD-005-W1 contract pins: capabilities.ts vs the LIVE repo manifests (the drift protection)', () => {
        test('every command of every live flauz-* manifest is claimed by EXACTLY ONE catalog entry (the set equality)', async () => {
                const closure = catalogClosure();
                assert.deepEqual(closure.problems, []);
                // enumerate the live manifests directly (the same enumeration the matrix runs)
                const entries = await nodeFs.readdir(joinPath(repoRoot, 'extensions'));
                const liveCommands = new Map<string, string>();
                for (const name of entries.filter(entry => /^flauz-[a-z0-9-]+$/.test(entry)).sort()) {
                        const text = await nodeFs.readFile(joinPath(repoRoot, 'extensions', name, 'package.json'), 'utf-8');
                        const parsed = JSON.parse(text) as { contributes?: { commands?: { command: string }[] } };
                        for (const command of parsed.contributes?.commands ?? []) {
                                liveCommands.set(command.command, name);
                        }
                }
                const claimed = new Map<string, string>();
                for (const entry of CAPABILITY_CATALOG) {
                        for (const command of entry.commands) {
                                claimed.set(command, entry.id);
                        }
                }
                const unclaimed = [...liveCommands.keys()].filter(command => !claimed.has(command));
                const vanished = [...claimed.keys()].filter(command => !liveCommands.has(command));
                assert.deepEqual(unclaimed, [], `no live command is undocumented (unclaimed: ${JSON.stringify(unclaimed)})`);
                assert.deepEqual(vanished, [], `no catalog claim references a command the product does not ship (vanished: ${JSON.stringify(vanished)})`);
        });

        test('the catalog owners are live extensions and every live extension with commands is documented', async () => {
                const entries = await nodeFs.readdir(joinPath(repoRoot, 'extensions'));
                const liveNames = new Set(entries.filter(entry => /^flauz-[a-z0-9-]+$/.test(entry)));
                for (const entry of CAPABILITY_CATALOG) {
                        assert.ok(liveNames.has(entry.owner), `the catalog owner ${entry.owner} is a live extension`);
                }
                const documentedOwners = new Set(CAPABILITY_CATALOG.map(entry => entry.owner));
                for (const name of liveNames) {
                        const text = await nodeFs.readFile(joinPath(repoRoot, 'extensions', name, 'package.json'), 'utf-8');
                        const parsed = JSON.parse(text) as { contributes?: { commands?: { command: string }[] } };
                        if ((parsed.contributes?.commands ?? []).length > 0) {
                                assert.ok(documentedOwners.has(name), `the live extension ${name} contributes commands and is documented`);
                        }
                }
        });
});
