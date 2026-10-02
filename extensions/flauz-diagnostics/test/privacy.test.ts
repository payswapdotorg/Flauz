/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W1 -- the REDACTION suite: the canary sweep (G8).
 *
 * Secret-shaped canaries are assembled from FRAGMENTS at runtime (no complete
 * secret shape is ever spelled out in this source file) and planted in the
 * REAL durable state through its owning services' own free-form fields (a
 * task event payload, an orchestration step output, an ops-record cause).
 * The law under test: a planted secret NEVER appears in any bundle byte.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { DiagnosticsError } from '../src/api.ts';
import { createSupportBundle } from '../src/bundle.ts';
import { looksSecretShaped, sweepArtifact } from '../src/privacy.ts';
import { bootFixtureWorkspace, readAllFiles, type FixtureWorkspace } from './helpers.ts';

/** Assembles a GitHub-token-shaped canary from fragments (never a complete literal in source). */
function ghCanary(): string {
        return ['ghp_', 'FlauzCanary', 'NeverShips0011223344'].join('');
}

/** Assembles an OpenAI-key-shaped canary from fragments. */
function skCanary(): string {
        return ['sk-', 'flauz', '-canary-000111222333444'].join('');
}

suite('privacy: the canary sweep over the real durable state', () => {
        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                // both canaries are planted in real free-form fields at construction time
                fixture = await bootFixtureWorkspace({ canaries: [ghCanary(), skCanary()] });
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('G8: a secret-shaped value planted in the durable state NEVER appears in any bundle byte', async () => {
                const result = await createSupportBundle({
                        root: fixture.root,
                        fs: fixture.fs,
                        clock: fixture.clock,
                        versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] },
                        environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
                });
                // the canaries ARE in the durable state (the plant took, through the real services)
                const durableFiles = await readAllFiles(path.join(fixture.root, '.flauz'));
                const durableBytes = durableFiles.filter(file => !file.path.includes('support-bundle-')).map(file => file.text).join('\n');
                assert.ok(durableBytes.includes(ghCanary()), 'the gh-shaped canary is really in the durable state (task event payload)');
                assert.ok(durableBytes.includes(skCanary()), 'the sk-shaped canary is really in the durable state (step output)');
                // ...and NEVER in the bundle
                const bundleFiles = await readAllFiles(result.bundleDir);
                assert.ok(bundleFiles.length >= 5, 'the full bundle was produced');
                for (const file of bundleFiles) {
                        assert.ok(!file.text.includes(ghCanary()), `${path.basename(file.path)} leaks the gh-shaped canary`);
                        assert.ok(!file.text.includes(skCanary()), `${path.basename(file.path)} leaks the sk-shaped canary`);
                }
        });

        test('the redaction (not a refusal) is what protects the tails: the bundle still succeeds with canaries planted in dropped-class fields', async () => {
                // free-form fields are contents-class: DROPPED by projection, so the bundle
                // succeeds and the canary rides nothing -- the drop law is the primary defense
                const result = await createSupportBundle({
                        root: fixture.root,
                        fs: fixture.fs,
                        clock: fixture.clock,
                        versions: { productVersion: '0.1.0', productName: 'Flauz', extensions: [] },
                        environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
                }, ['recent-events', 'diagnostics']);
                const events = JSON.parse(await fs.readFile(path.join(result.bundleDir, 'recent-events.json'), 'utf-8')) as {
                        executionJournal: { tail: Array<Record<string, unknown>> };
                };
                for (const row of events.executionJournal.tail) {
                        // the step-succeeded row whose output carried the canary: the payload is dropped whole
                        assert.ok(!('output' in row), 'no output field rides the redacted tail');
                }
        });

        test('the fail-closed backstop: a secret-shaped value that WOULD reach an artifact refuses the bundle with the typed error', async () => {
                // defense-in-depth: the sweep over an assembled artifact carrying a secret refuses
                assert.throws(
                        () => sweepArtifact({ note: `token ${ghCanary()} was here` }, 'poisoned.json'),
                        (err: unknown) => {
                                assert.ok(err instanceof DiagnosticsError);
                                assert.strictEqual(err.code, 'FLAUZ_DIAG_SECRET_SHAPED');
                                assert.match(err.message, /secret-shaped literal refused/);
                                return true;
                        },
                );
        });

        test('the sweep is deep: nested arrays and objects are walked, and every known credential shape is caught', () => {
                // the pattern list parity: every shape class the flauz-resources discipline names
                const shapes: string[] = [
                        ghCanary(), // ghp_ classic
                        ['github_pat_', 'FlauzCanaryNeverShips', '_0011223344556677'].join(''), // github fine-grained
                        skCanary(), // OpenAI-style
                        ['sk-ant-', 'flauzcanary', 'never-ships-000111'].join(''), // Anthropic-style
                        ['AKIA', 'FLAUZCANARY00011'].join(''), // AWS access key (16 uppercase/digit chars after the prefix)
                        ['xoxb-', 'flauz-canary-00011122'].join(''), // Slack token
                        ['-----BEGIN', ' RSA PRIVATE KEY-----'].join(''), // PEM private key
                        ['Bearer ', 'flauz-canary-00011122233344'].join(''), // bearer header
                        ['eyJ', 'flauz-canary', '.', '000111222aaabbbccc', '.', 'dddeeefff000111222333'].join(''), // JWT
                ];
                for (const shape of shapes) {
                        assert.ok(looksSecretShaped(shape), `the shape class of ${String(shape.slice(0, 12))}... is detected`);
                        assert.throws(() => sweepArtifact({ deep: { list: [shape] } }, 'deep.json'), /secret-shaped literal refused/);
                }
                // and benign strings never trip it (no false-positive wall)
                for (const benign of ['ordinary note', 'sha256:5d41402abc4b2a76b9719d911017c592', 'https://example.invalid/search?q=flauz', 'bearer of good news', 'sk-small']) {
                        assert.ok(!looksSecretShaped(benign), `${benign} is not secret-shaped`);
                }
        });
});
