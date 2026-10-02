/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W1 -- the CONTRACT-PIN suite: the duplicated contract shapes
 * (DL-32) are pinned byte-equal against the OWNING modules and node:crypto.
 * The duplication is the point (a diagnostics verdict must not depend on the
 * verified extension's code); these pins keep it honest.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { canonicalJson, serializeArtifact, sha256Hex } from '../src/api.ts';
import { ledgerRowHash, opsRecordHash, parseLedgerLine, parseOpsLine } from '../src/verify.ts';
import { canonicalJson as workspaceCanonicalJson, sha256Hex as workspaceSha256Hex } from '../../flauz-workspace/src/api.ts';
import { canonicalJson as resourcesCanonicalJson, sha256Hex as resourcesSha256Hex } from '../../flauz-resources/src/api.ts';
import { rowHash as workspaceRowHash, rowLine } from '../../flauz-workspace/src/ledger.ts';
import { opRecordHash as resourcesOpRecordHash, opLine } from '../../flauz-resources/src/provenance.ts';

suite('contract pins: the duplication is byte-equal with the owning modules', () => {

        test('sha256Hex + canonicalJson are byte-identical to the owning implementations and node:crypto', () => {
                const samples = ['', 'flauz', '{"a":1,"b":[2,3]}', '{"z":1,"a":{"y":true,"n":null}}', 'x'.repeat(1000), 'ünïcödé ✓'];
                for (const sample of samples) {
                        const nodeCrypto = createHash('sha256').update(sample, 'utf8').digest('hex');
                        assert.strictEqual(sha256Hex(sample), nodeCrypto, `sha256Hex matches node:crypto on ${JSON.stringify(sample.slice(0, 20))}`);
                        assert.strictEqual(sha256Hex(sample), workspaceSha256Hex(sample), 'sha256Hex matches flauz-workspace');
                        assert.strictEqual(sha256Hex(sample), resourcesSha256Hex(sample), 'sha256Hex matches flauz-resources');
                }
                const value = { b: 2, a: [3, { d: null, c: 'x' }] };
                assert.strictEqual(canonicalJson(value), workspaceCanonicalJson(value), 'canonicalJson matches flauz-workspace');
                assert.strictEqual(canonicalJson(value), resourcesCanonicalJson(value), 'canonicalJson matches flauz-resources');
                assert.strictEqual(canonicalJson(value), '{"a":[3,{"c":"x","d":null}],"b":2}');
                // the artifact serializer discipline: sorted keys, 2-space, exactly one trailing newline
                assert.strictEqual(serializeArtifact({ b: 1, a: 2 }), '{\n  "a": 2,\n  "b": 1\n}\n');
        });

        test('the ledger row hash re-derives exactly like the owning flauz-workspace rowHash', async () => {
                const ledgerLine = '{"kind":"note","prev":null,"seq":1,"sha256":"5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a","taskId":"T-001","ts":1740000000000,"uri":".flauz/artifacts/T-001/note.txt"}';
                const mine = parseLedgerLine(ledgerLine, 1);
                assert.ok(mine.ok, 'the duplicated parser accepts a real owning-format row');
                const owningRow = JSON.parse(ledgerLine) as Record<string, unknown>;
                // the owning rowLine(row) over its own parse equals our ledgerRowHash input
                assert.strictEqual(
                        ledgerRowHash(mine.ok ? mine.row : null as never),
                        workspaceRowHash(owningRow as never),
                        'the chain link value is byte-identical to the owning rowHash',
                );
                // and it equals sha256 over the owning canonical line
                assert.strictEqual(ledgerRowHash(mine.ok ? mine.row : null as never), workspaceSha256Hex(rowLine(owningRow as never)));
        });

        test('the ops record hash re-derives exactly like the owning flauz-resources opRecordHash', () => {
                const opsLineText = '{"actor":"human","actorId":"test-driver","afterDigest":"5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a","beforeDigest":"5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a","cause":"fixture","op":"add-ref","prev":null,"refId":"flauz:task:T-001","seq":1,"ts":1740000000000}';
                const mine = parseOpsLine(opsLineText, 1);
                assert.ok(mine.ok, 'the duplicated parser accepts a real owning-format record');
                const owningRecord = JSON.parse(opsLineText) as Record<string, unknown>;
                assert.strictEqual(
                        opsRecordHash(mine.ok ? mine.row : null as never),
                        resourcesOpRecordHash(owningRecord as never),
                        'the chain link value is byte-identical to the owning opRecordHash',
                );
                assert.strictEqual(opsRecordHash(mine.ok ? mine.row : null as never), resourcesSha256Hex(opLine(owningRecord as never)));
                // an ops record with a free-form note: our projection drops it, our hash keeps it (chain integrity)
                const withNote = JSON.parse(opsLineText) as Record<string, unknown>;
                withNote.seq = 2;
                withNote.prev = opsRecordHash(mine.ok ? mine.row : null as never);
                withNote.note = 'a note';
                const withNoteParsed = parseOpsLine(JSON.stringify(withNote), 2);
                assert.ok(withNoteParsed.ok);
                assert.strictEqual(withNoteParsed.ok && 'note' in withNoteParsed.row, true, 'the parser preserves the note for hashing');
        });

        test('the shared environments registry fixture parses to the pinned census count', async () => {
                // the same fixture the flauz-resources contract tests pin (cross-worker contract surface)
                const { readFile } = await import('node:fs/promises');
                const { fileURLToPath } = await import('node:url');
                const fixturePath = fileURLToPath(new URL('../../../test/fixtures/resources/contracts/environments-registry.json', import.meta.url));
                const parsed = JSON.parse(await readFile(fixturePath, 'utf-8')) as { environments: unknown[] };
                assert.strictEqual(parsed.environments.length, 2);
                assert.strictEqual(parsed.environments.map(entry => (entry as { id: string }).id).sort().join(','), 'env-build-box,env-staging');
        });
});
