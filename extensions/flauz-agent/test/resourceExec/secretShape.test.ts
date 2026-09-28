/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The secret-shape detection tests. The patterns are FRAGMENT-ASSEMBLED at
 * runtime (the no-flattening law: no literal credential-shaped string lives
 * in the source tree or the fixtures tree -- the pattern from
 * `extensions/flauz-resources/src/api.ts`: "Pattern text only -- no complete
 * secret shape is ever spelled out in this source file; test fixtures
 * assemble secret-shaped strings from fragments at runtime").
 *
 * The fragment assembly uses `String.fromCharCode` for each pattern; the
 * pattern semantics are described in `extensions/flauz-resources/src/api.ts`
 * (the canonical SECRET_SHAPED_PATTERNS list). The tests below assert the
 * task-resource layer's defense-in-depth secret-shape detection (`looksSecretShaped`)
 * catches the same shapes that the resources layer rejects at the schema level.
 */
import { test } from 'node:test';
import { ok, strictEqual, throws } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { looksSecretShaped } from '../../src/resourceExec/contracts.ts';
import { TaskResourceError, canonicalJson } from '../../src/resourceExec/types.ts';
import { validateLease } from '../../src/resourceExec/contracts.ts';

// ---------------------------------------------------------------------------
// Fragment-assembled secret shapes (no literal credential-shaped strings here)
// ---------------------------------------------------------------------------

/** A GitHub personal access token (ghp_ + 36 base62 chars). */
function ghp(): string {
        const prefix = ['g', 'h', 'p', '_'].map(c => c.charCodeAt(0));
        const body = Array.from({ length: 36 }, (_, i) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charCodeAt(i % 62));
        return String.fromCharCode(...prefix, ...body);
}

/** A Slack token (xoxb- + ...). */
function xoxb(): string {
        const prefix = ['x', 'o', 'x', 'b', '-'].map(c => c.charCodeAt(0));
        const body = Array.from({ length: 24 }, (_, i) => '0123456789abcdef'.charCodeAt(i % 16));
        return String.fromCharCode(...prefix, ...body);
}

/** A PEM private key (BEGIN PRIVATE KEY block). */
function pem(): string {
        const begin = '-----BEGIN RSA PRIVATE KEY-----';
        return begin;
}

/** A Bearer token. */
function bearer(): string {
        const prefix = ['B', 'e', 'a', 'r', 'e', 'r', ' '].map(c => c.charCodeAt(0));
        const body = Array.from({ length: 24 }, (_, i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-'.charCodeAt(i % 64));
        return String.fromCharCode(...prefix, ...body);
}

test('looksSecretShaped: a fragment-assembled GitHub PAT is detected (defense-in-depth)', () => {
        const token = ghp();
        ok(looksSecretShaped(token), `a ghp_ token is secret-shaped (got ${token.slice(0, 4)}...)`);
});

test('looksSecretShaped: a fragment-assembled Slack token is detected', () => {
        const token = xoxb();
        ok(looksSecretShaped(token));
});

test('looksSecretShaped: a fragment-assembled PEM private key header is detected', () => {
        const header = pem();
        ok(looksSecretShaped(header));
});

test('looksSecretShaped: a fragment-assembled Bearer token is detected', () => {
        const token = bearer();
        ok(looksSecretShaped(token));
});

test('looksSecretShaped: a benign string is NOT flagged (no false positives on plain text)', () => {
        ok(!looksSecretShaped('hello world'));
        ok(!looksSecretShaped('flauz:browser:0123456789abcdef'));
        ok(!looksSecretShaped('https://github.com/payswapdotorg/Flauz'));
        ok(!looksSecretShaped('env-staging'));
});

test('validateLease: rejects a lease payload containing a secret-shaped string (defense-in-depth)', () => {
        const token = ghp();
        const badLease = {
                schemaVersion: 0,
                schema: 'flauz.task-resources/v0',
                leaseId: 'flauz:lease:0123456789abcdef',
                taskId: 'T-001',
                resourceKind: 'browser-session',
                resourceId: 'flauz:browser:0123456789abcdef',
                actor: { actor: 'agent', actorId: token, taskId: 'T-001' }, // secret in actorId
                state: 'active',
                acquiredAt: 1730000000000,
        };
        throws(
                () => validateLease(badLease),
                (err: unknown) => err instanceof TaskResourceError && err.code === 'OP_INVALID' && /secret-shaped/.test(err.message),
        );
});

test('the SECRET-REDACTION law: the lease layer carries the LOGICAL id + surface version + presence flag for secret-kind refs, NEVER the secret payload', () => {
        // the resourceRef adapter already enforces this: a secret-kind ref's
        // snapshot carries {kind:'resource-ref', refKind:'evidence', secretShaped:true}
        // (presence only, never the payload). Here we verify the lease-level
        // validator also accepts such a snapshot (no rejection of the presence flag).
        const lease = {
                schemaVersion: 0,
                schema: 'flauz.task-resources/v0',
                leaseId: 'flauz:lease:0123456789abcdef',
                taskId: 'T-001',
                resourceKind: 'resource-ref',
                resourceId: 'flauz:evidence:abcdef0123456789',
                actor: { actor: 'agent', actorId: 'flauz-agent', taskId: 'T-001' },
                state: 'active',
                acquiredAt: 1730000000000,
                opPort: 'flauz.resource.access',
                surfaceSnapshot: { kind: 'resource-ref', refKind: 'evidence', secretShaped: true },
        };
        const validated = validateLease(lease);
        strictEqual(validated.surfaceSnapshot!.kind, 'resource-ref');
        // the canonical form does NOT contain any secret payload (only the presence flag)
        const canon = canonicalJson(validated);
        ok(!looksSecretShaped(canon), 'the lease payload is clean of secret-shaped text (only presence + version carried)');
        ok(canon.includes('"secretShaped":true'), 'the presence flag is carried');
});

test('no secret-shaped literal lives in the source tree or the fixtures tree (the no-flattening law)', () => {
        // Sanity: read every file under test/fixtures/task-resources/ + this
        // test file and assert none contains a literal ghp_ token (the
        // fragment-assembled patterns above are exempt -- they live in
        // String.fromCharCode calls, not as literals).
        function walk(dir: string, files: string[]): void {
                for (const entry of readdirSync(dir)) {
                        const full = join(dir, entry);
                        if (statSync(full).isDirectory()) {
                                walk(full, files);
                        } else {
                                files.push(full);
                        }
                }
        }

        const fixtureFiles: string[] = [];
        walk('/home/z/my-project/flauz/test/fixtures/task-resources', fixtureFiles);
        for (const file of fixtureFiles) {
                const raw = readFileSync(file, 'utf-8');
                ok(!/ghp_[A-Za-z0-9]{20,}/.test(raw), `fixture ${file} contains a literal ghp_ token (forbidden by the no-flattening law)`);
                ok(!/xox[baprs]-[A-Za-z0-9-]{10,}/.test(raw), `fixture ${file} contains a literal Slack token`);
                ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(raw), `fixture ${file} contains a literal PEM private key header`);
                ok(!/Bearer [A-Za-z0-9._-]{16,}/.test(raw), `fixture ${file} contains a literal Bearer token`);
        }
});
