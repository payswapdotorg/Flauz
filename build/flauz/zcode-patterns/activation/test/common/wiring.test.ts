/*
 * MIT License
 * Copyright (c) 2025 the Flauz contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/*
 * CR-001 - the machine-check suite for the activation spine.
 *
 * RUN FROM THE REPO ROOT (the existence matrix resolves every cited path
 * against process.cwd()):
 *
 *   NODE_OPTIONS=--import tsx npx mocha --ui tdd \
 *     build/flauz/zcode-patterns/activation/test/common/*.test.ts
 *
 * Deterministic by construction: the fs walks are sorted and no test body
 * touches Date.now, Math.random, or any randomness.
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
        ACTIVATION_CONTRACTS_VERSION,
        AUTHORITIES,
        WIRING,
        type WiringEntry
} from '../../common/wiring.ts';
import {
        AUTHORITY_IDS,
        EVIDENCE_KINDS,
        GAP_OWNER_IDS,
        allContractModules,
        entriesForAuthority,
        gapEntries,
        wiredEntries,
        wiringInvariant
} from '../../common/coverage.ts';

const REPO_ROOT = process.cwd();

const CAPABILITY_IDS: readonly string[] = [
        'ZC-001', 'ZC-002', 'ZC-003', 'ZC-004', 'ZC-005',
        'ZC-006', 'ZC-007', 'ZC-008', 'ZC-009', 'ZC-010'
];

const SUBTREES: readonly string[] = [
        'build/flauz/zcode-patterns/common',
        'build/flauz/zcode-patterns/hook-bus',
        'build/flauz/zcode-patterns/observatory',
        'build/flauz/zcode-patterns/memory',
        'build/flauz/zcode-patterns/cli',
        'build/flauz/zcode-patterns/parity',
        'build/flauz/capabilities/background-agent',
        'build/flauz/capabilities/packs',
        'build/flauz/capabilities/sources',
        'build/flauz/capabilities/commands'
];

const EXPECTED_AUTHORITY_ROOTS: Readonly<Record<string, string>> = {
        AGENT_OS: 'extensions/flauz-agent',
        WORKSPACE_OS: 'extensions/flauz-workspace',
        EXECUTION: 'extensions/flauz-execution',
        WORKFLOW: 'extensions/flauz-workflow',
        MEMORY: 'extensions/flauz-memory',
        LAB: 'extensions/flauz-lab',
        BROWSER: 'extensions/flauz-browser',
        MODELS: 'extensions/flauz-models',
        RESOURCES: 'extensions/flauz-resources',
        INTEGRITY: 'extensions/flauz-integrity',
        ENVIRONMENTS: 'extensions/flauz-environments',
        ACCEPTANCE: 'extensions/flauz-acceptance',
        CAPABILITY_EXCHANGE: 'build/flauz/capabilities'
};

const README_PATH = 'build/flauz/zcode-patterns/activation/README.md';

function toPosix(p: string): string {
        return p.split(path.sep).join('/');
}

/**
 * Layout-agnostic contract-module walk: every .ts file under the subtree
 * except test/tests/node_modules/.git directories and *.test.ts files. This is
 * the operationalization of "common/*.ts under the subtree" that keeps the
 * no-orphan/no-phantom guarantee under either a flat or a nested layout.
 */
function walkContractModules(rootAbs: string): string[] {
        const found: string[] = [];
        const stack: string[] = [rootAbs];
        while (stack.length > 0) {
                const dir = stack.pop() as string;
                const dirents = fs.readdirSync(dir, { withFileTypes: true });
                for (const dirent of dirents) {
                        if (dirent.name === 'test' || dirent.name === 'tests'
                                || dirent.name === 'node_modules' || dirent.name === '.git') {
                                continue;
                        }
                        const child = path.join(dir, dirent.name);
                        if (dirent.isDirectory()) {
                                stack.push(child);
                        } else if (dirent.isFile()
                                && dirent.name.endsWith('.ts')
                                && !dirent.name.endsWith('.test.ts')) {
                                found.push(child);
                        }
                }
        }
        return found
                .map((child) => path.relative(REPO_ROOT, child))
                .map(toPosix)
                .sort();
}

const diskModules: string[] = [];
for (const subtree of SUBTREES) {
        diskModules.push(...walkContractModules(path.resolve(REPO_ROOT, subtree)));
}
diskModules.sort();

/** A well-formed synthetic entry; overrides mutate it into a law-breaker. */
function syntheticEntry(overrides: Record<string, unknown>): WiringEntry {
        const base: WiringEntry = {
                capabilityId: 'ZC-000',
                title: 'synthetic probe entry (never touches disk)',
                contractModules: ['build/flauz/zcode-patterns/common/hooks.ts'],
                authority: 'AGENT_OS',
                state: 'wired',
                entryPoints: [
                        { path: 'extensions/flauz-agent/src/types.ts', role: 'probe' }
                ],
                stateSource: 'probe',
                projection: 'probe',
                tests: ['build/flauz/dogfood/dogfood.test.ts'],
                evidence: 'simulated'
        };
        return { ...base, ...overrides } as unknown as WiringEntry;
}

suite('CR-001 activation spine', function () {

        suite('map shape', function () {
                test('exactly ten entries', function () {
                        assert.strictEqual(WIRING.length, 10);
                });
                test('capability ids are exactly ZC-001 through ZC-010', function () {
                        assert.deepEqual(
                                WIRING.map((entry) => entry.capabilityId).sort(),
                                [...CAPABILITY_IDS].sort()
                        );
                });
                test('no duplicate capability ids', function () {
                        const ids = WIRING.map((entry) => entry.capabilityId);
                        assert.strictEqual(new Set(ids).size, ids.length);
                });
                test('version pin is 1.0.0', function () {
                        assert.strictEqual(ACTIVATION_CONTRACTS_VERSION, '1.0.0');
                });
                test('every evidence label is a frozen vocabulary member', function () {
                        for (const entry of WIRING) {
                                assert.ok(
                                        EVIDENCE_KINDS.includes(entry.evidence),
                                        `${entry.capabilityId}: evidence outside the frozen vocabulary`
                                );
                        }
                });
        });

        suite('coverage walk', function () {
                test('all ten contract subtrees exist on disk', function () {
                        for (const subtree of SUBTREES) {
                                assert.ok(
                                        fs.existsSync(path.resolve(REPO_ROOT, subtree)),
                                        `subtree must exist: ${subtree}`
                                );
                        }
                });
                test('no orphans: every contract module on disk is cited by the map', function () {
                        const mapped = new Set(allContractModules(WIRING));
                        const orphans = diskModules.filter((mod) => !mapped.has(mod));
                        assert.deepEqual(orphans, []);
                });
                test('no phantoms: every mapped contract module exists on disk', function () {
                        const disk = new Set(diskModules);
                        const phantoms = allContractModules(WIRING).filter((mod) => !disk.has(mod));
                        assert.deepEqual(phantoms, []);
                });
                test('allContractModules is deduped and sorted', function () {
                        const modules = allContractModules(WIRING);
                        assert.deepEqual(modules, [...new Set(modules)].sort());
                });
                test('each of the ten subtrees contributes at least one mapped module', function () {
                        const modules = allContractModules(WIRING);
                        for (const subtree of SUBTREES) {
                                assert.ok(
                                        modules.some((mod) => mod.startsWith(`${subtree}/`)),
                                        `no mapped contract module under ${subtree}`
                                );
                        }
                });
        });

        suite('existence matrix', function () {
                test('every contractModules path resolves on disk', function () {
                        for (const entry of WIRING) {
                                for (const mod of entry.contractModules) {
                                        assert.ok(
                                                fs.existsSync(path.resolve(REPO_ROOT, mod)),
                                                `${entry.capabilityId} cites a missing module: ${mod}`
                                        );
                                }
                        }
                });
                test('every wired entryPoints path resolves on disk', function () {
                        for (const entry of wiredEntries(WIRING)) {
                                assert.notStrictEqual(entry.entryPoints.length, 0);
                                for (const ep of entry.entryPoints) {
                                        assert.ok(
                                                fs.existsSync(path.resolve(REPO_ROOT, ep.path)),
                                                `${entry.capabilityId} cites a missing entry point: ${ep.path}`
                                        );
                                }
                        }
                });
        });

        suite('invariants', function () {
                test('wiringInvariant passes for all ten entries', function () {
                        for (const entry of WIRING) {
                                const result = wiringInvariant(entry);
                                if (!result.ok) {
                                        assert.fail(`${entry.capabilityId}: ${result.violations.join('; ')}`);
                                }
                        }
                });
                test('rejects a wired entry with empty entryPoints', function () {
                        const result = wiringInvariant(syntheticEntry({ entryPoints: [] }));
                        assert.ok(!result.ok, 'expected a violation');
                        assert.ok(!result.ok && result.violations.some((v) => v.includes('entryPoint')));
                });
                test('rejects a gap entry that declares entryPoints', function () {
                        const result = wiringInvariant(syntheticEntry({
                                state: 'gap',
                                entryPoints: [{ path: 'extensions/flauz-agent/src/types.ts', role: 'probe' }],
                                gapOwner: 'CR-002',
                                gapNote: 'probe note'
                        }));
                        assert.ok(!result.ok, 'expected a violation');
                        assert.ok(!result.ok && result.violations.some((v) => v.includes('entryPoints')));
                });
                test('rejects a gap entry without gapOwner and gapNote', function () {
                        const result = wiringInvariant(syntheticEntry({ state: 'gap' }));
                        assert.ok(!result.ok, 'expected a violation');
                        assert.ok(!result.ok && result.violations.some((v) => v.includes('gapOwner')));
                        assert.ok(!result.ok && result.violations.some((v) => v.includes('gapNote')));
                });
                test('rejects a wired entry that carries a gapOwner', function () {
                        const result = wiringInvariant(syntheticEntry({ gapOwner: 'CR-002', gapNote: 'probe' }));
                        assert.ok(!result.ok, 'expected a violation');
                        assert.ok(!result.ok && result.violations.some((v) => v.includes('gapOwner')));
                });
                test('rejects an authority outside the frozen table', function () {
                        const result = wiringInvariant(syntheticEntry({ authority: 'NOT_AN_AUTHORITY' }));
                        assert.ok(!result.ok, 'expected a violation');
                        assert.ok(!result.ok && result.violations.some((v) => v.includes('authority')));
                });
                test('rejects an evidence label outside the vocabulary', function () {
                        const result = wiringInvariant(syntheticEntry({ evidence: 'hearsay' }));
                        assert.ok(!result.ok, 'expected a violation');
                        assert.ok(!result.ok && result.violations.some((v) => v.includes('evidence')));
                });
                test('rejects an entry with empty contractModules', function () {
                        const result = wiringInvariant(syntheticEntry({ contractModules: [] }));
                        assert.ok(!result.ok, 'expected a violation');
                        assert.ok(!result.ok && result.violations.some((v) => v.includes('contractModules')));
                });
        });

        suite('gap honesty', function () {
                test('every gap entry names a real CR id', function () {
                        for (const entry of gapEntries(WIRING)) {
                                assert.ok(entry.gapOwner !== undefined, `${entry.capabilityId}: missing gapOwner`);
                                assert.ok(
                                        GAP_OWNER_IDS.includes(entry.gapOwner as string),
                                        `${entry.capabilityId}: gapOwner must be a real CR id`
                                );
                        }
                });
                test('every gap entry carries a non-empty gapNote', function () {
                        for (const entry of gapEntries(WIRING)) {
                                assert.ok(
                                        entry.gapNote !== undefined && entry.gapNote.trim().length > 0,
                                        `${entry.capabilityId}: gapNote must be non-empty`
                                );
                        }
                });
                test('wired entries carry neither gapOwner nor gapNote', function () {
                        for (const entry of wiredEntries(WIRING)) {
                                assert.strictEqual(entry.gapOwner, undefined);
                                assert.ok(entry.gapNote === undefined || entry.gapNote.trim() === '');
                        }
                });
                test('every wired entry has at least one on-disk pinning suite', function () {
                        for (const entry of wiredEntries(WIRING)) {
                                assert.ok(entry.tests.length > 0, `${entry.capabilityId}: wired entries must cite suites`);
                                assert.ok(
                                        entry.tests.some((t) => fs.existsSync(path.resolve(REPO_ROOT, t))),
                                        `${entry.capabilityId}: at least one cited suite must exist on disk`
                                );
                        }
                });
        });

        suite('authorities', function () {
                test('every authority used by the map exists in AUTHORITIES', function () {
                        for (const entry of WIRING) {
                                assert.ok(
                                        Object.prototype.hasOwnProperty.call(AUTHORITIES, entry.authority),
                                        `${entry.capabilityId}: authority ${entry.authority} missing from AUTHORITIES`
                                );
                        }
                });
                test('AUTHORITIES covers all thirteen frozen authority ids', function () {
                        assert.deepEqual(
                                Object.keys(AUTHORITIES).sort(),
                                [...AUTHORITY_IDS].sort()
                        );
                });
                test('every AUTHORITIES root exists on disk', function () {
                        for (const id of Object.keys(AUTHORITIES)) {
                                const root = AUTHORITIES[id as keyof typeof AUTHORITIES].root;
                                assert.ok(
                                        fs.existsSync(path.resolve(REPO_ROOT, root)),
                                        `${id}: root must exist on disk: ${root}`
                                );
                        }
                });
                test('AUTHORITIES roots are the real owner dirs', function () {
                        assert.deepEqual(
                                Object.keys(EXPECTED_AUTHORITY_ROOTS).sort(),
                                [...AUTHORITY_IDS].sort()
                        );
                        for (const id of Object.keys(EXPECTED_AUTHORITY_ROOTS)) {
                                const record = AUTHORITIES[id as keyof typeof AUTHORITIES];
                                assert.strictEqual(record.root, EXPECTED_AUTHORITY_ROOTS[id]);
                        }
                });
                test('entriesForAuthority partitions all ten entries', function () {
                        const collected = AUTHORITY_IDS.flatMap((id) => entriesForAuthority(WIRING, id));
                        assert.strictEqual(collected.length, WIRING.length);
                });
        });

        suite('determinism', function () {
                test('pure resolvers are stable across two invocations', function () {
                        const first = {
                                wired: wiredEntries(WIRING).map((entry) => entry.capabilityId),
                                gap: gapEntries(WIRING).map((entry) => entry.capabilityId)
                        };
                        const second = {
                                wired: wiredEntries(WIRING).map((entry) => entry.capabilityId),
                                gap: gapEntries(WIRING).map((entry) => entry.capabilityId)
                        };
                        assert.deepEqual(first, second);
                });
                test('allContractModules double-run deep-equal', function () {
                        assert.deepEqual(allContractModules(WIRING), allContractModules(WIRING));
                });
                test('wired and gap partition the map', function () {
                        assert.strictEqual(
                                wiredEntries(WIRING).length + gapEntries(WIRING).length,
                                WIRING.length
                        );
                });
        });

        suite('readme pins', function () {
                test('README cites every capability id', function () {
                        const readme = fs.readFileSync(path.resolve(REPO_ROOT, README_PATH), 'utf8');
                        for (const id of CAPABILITY_IDS) {
                                assert.ok(readme.includes(id), `README must cite ${id}`);
                        }
                });
                test('README cites every cited gap owner', function () {
                        const readme = fs.readFileSync(path.resolve(REPO_ROOT, README_PATH), 'utf8');
                        for (const entry of gapEntries(WIRING)) {
                                assert.ok(
                                        readme.includes(entry.gapOwner as string),
                                        `README must cite ${entry.gapOwner}`
                                );
                        }
                });
                test('README contains the authority table and the gap table', function () {
                        const readme = fs.readFileSync(path.resolve(REPO_ROOT, README_PATH), 'utf8');
                        assert.ok(readme.includes('## Authority table'));
                        assert.ok(readme.includes('## Gap table'));
                });
                test('README cites every authority id', function () {
                        const readme = fs.readFileSync(path.resolve(REPO_ROOT, README_PATH), 'utf8');
                        for (const id of AUTHORITY_IDS) {
                                assert.ok(readme.includes(id), `README must cite ${id}`);
                        }
                });
        });
});