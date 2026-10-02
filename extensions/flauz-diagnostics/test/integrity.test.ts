/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W1 -- the INTEGRITY suite: the tamper-evidence verdicts over
 * real chains, tampered chains, and the cross-check against the owning
 * extensions' OWN verifiers (the duplication-is-honest pin).
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { joinPath } from '../src/api.ts';
import { collectIntegrity, verifyLedgerChain, verifyOpsChain } from '../src/verify.ts';
import { EvidenceLedger, rowHash } from '../../flauz-workspace/src/ledger.ts';
import { LEDGER_PATH } from '../../flauz-workspace/src/api.ts';
import { ProvenanceLedger } from '../../flauz-resources/src/provenance.ts';
import { bootFixtureWorkspace, nodeWorkspaceFs, type FixtureWorkspace } from './helpers.ts';

suite('integrity: the verdicts over the real chains', () => {
        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('the good chains verify ok, and the verdicts agree with the OWNING verifiers (the contract-duplication pin)', async () => {
                const mine = await collectIntegrity(fixture.root, fixture.fs);
                assert.strictEqual(mine.evidenceLedger.ok, true);
                assert.strictEqual(mine.opsChain.ok, true);

                // the owning verifier over the same on-disk chain (constructed independently)
                const realLedger = new EvidenceLedger({ root: fixture.root, fs: nodeWorkspaceFs(), clock: fixture.clock });
                const real = await realLedger.verify();
                assert.strictEqual(real.ok, true, 'the real verifier agrees the real chain is good');
                assert.strictEqual(mine.evidenceLedger.rows, real.rows, 'both count the same rows');
                const realRows = await realLedger.readRows();
                assert.strictEqual(mine.evidenceLedger.headSha256, rowHash(realRows[realRows.length - 1] as never), 'the chain-head hash matches the owning rowHash');

                // the owning ops verifier over the same ops chain
                const realOps = new ProvenanceLedger({ root: fixture.root, fs: nodeWorkspaceFs(), clock: fixture.clock });
                const realOpsReport = await realOps.verifyChain();
                assert.strictEqual(realOpsReport.ok, true, 'the real ops verifier agrees the real chain is good');
                assert.strictEqual(mine.opsChain.records, realOpsReport.records, 'both count the same ops records');
        });

        test('a mutated ledger row fails with the first bad seq (in-place content tamper)', async () => {
                const ledgerPath = joinPath(fixture.root, LEDGER_PATH);
                const original = await fs.readFile(ledgerPath, 'utf-8');
                const lines = original.split('\n');
                const mutated = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
                mutated.uri = '.flauz/artifacts/T-001/DOCTORED.txt';
                lines[0] = JSON.stringify(mutated);
                await fs.writeFile(ledgerPath, lines.join('\n'));

                const verdict = await verifyLedgerChain(fixture.root, fixture.fs);
                assert.strictEqual(verdict.ok, false);
                assert.strictEqual(verdict.rows, 1, 'the prefix before the tamper still validates');
                assert.strictEqual(verdict.firstBadSeq, 2, 'the mutated row 1 surfaces at row 2 (the prev-linkage break, the owning verifier semantics)');

                // the owning verifier also fails (class parity)
                const realLedger = new EvidenceLedger({ root: fixture.root, fs: nodeWorkspaceFs(), clock: fixture.clock });
                assert.strictEqual((await realLedger.verify()).ok, false);

                await fs.writeFile(ledgerPath, original);
                assert.strictEqual((await verifyLedgerChain(fixture.root, fixture.fs)).ok, true, 'restored -> ok again');
        });

        test('a deleted middle ledger row fails the seq contiguity class', async () => {
                const ledgerPath = joinPath(fixture.root, LEDGER_PATH);
                const original = await fs.readFile(ledgerPath, 'utf-8');
                const lines = original.split('\n').filter(line => line !== '');
                // the fixture has 2 rows; append a third so a middle deletion is expressible
                const second = JSON.parse(lines[lines.length - 1] ?? '') as Record<string, unknown>;
                const third = { ...second, seq: 3, prev: rowHash(JSON.parse(JSON.stringify(second)) as never) };
                const withThree = `${[...lines, JSON.stringify(third)].join('\n')}\n`;
                await fs.writeFile(ledgerPath, withThree);
                const base = await verifyLedgerChain(fixture.root, fixture.fs);
                assert.strictEqual(base.ok, true, 'the three-row chain is good before the deletion');

                const tampered = withThree.split('\n').filter(line => line !== '');
                tampered.splice(1, 1);
                await fs.writeFile(ledgerPath, `${tampered.join('\n')}\n`);
                const verdict = await verifyLedgerChain(fixture.root, fixture.fs);
                assert.strictEqual(verdict.ok, false);
                assert.strictEqual(verdict.firstBadSeq, 3, 'the row after the gap (seq 3 at expected 2) is the first bad seq (the owning row.seq semantics)');

                await fs.writeFile(ledgerPath, original);
        });

        test('a truncated ledger tail with a live size watermark fails the watermark class (truncated: true)', async () => {
                // harden the ledger first: the real appendCheckpoint writes the size watermark
                const hardened = new EvidenceLedger({ root: fixture.root, fs: nodeWorkspaceFs(), clock: fixture.clock, signer: new FixtureSigner() });
                await hardened.appendCheckpoint();
                const withWatermark = await verifyLedgerChain(fixture.root, fixture.fs);
                assert.strictEqual(withWatermark.ok, true, 'the checkpointed chain + watermark verify ok');
                assert.strictEqual(withWatermark.checkpoints?.count, 1, 'the checkpoint row is counted');
                assert.strictEqual(withWatermark.checkpoints?.signatureVerification, 'owner-side (the user keystore never enters a bundle)');

                // truncate the tail (drop the final row): the watermark must catch it
                const ledgerPath = joinPath(fixture.root, LEDGER_PATH);
                const rows = (await fs.readFile(ledgerPath, 'utf-8')).split('\n').filter(line => line !== '');
                rows.pop();
                await fs.writeFile(ledgerPath, `${rows.join('\n')}\n`);
                const verdict = await verifyLedgerChain(fixture.root, fixture.fs);
                assert.strictEqual(verdict.ok, false);
                assert.strictEqual(verdict.truncated, true, 'the mismatch is classified as a truncated tail');
                assert.strictEqual(verdict.watermark?.status, 'mismatch');

                // the owning verifier fails too (class parity)
                const realLedger = new EvidenceLedger({ root: fixture.root, fs: nodeWorkspaceFs(), clock: fixture.clock, signer: new FixtureSigner() });
                const real = await realLedger.verify();
                assert.strictEqual(real.ok, false);
                assert.strictEqual(real.truncated, true, 'the owning verifier also classifies it as truncated');
        });

        test('an ops-chain in-place tamper surfaces the prev-linkage problem', async () => {
                const opsPath = joinPath(fixture.root, '.flauz/resources-ops.jsonl');
                const original = await fs.readFile(opsPath, 'utf-8');
                const lines = original.split('\n').filter(line => line !== '');
                // tamper a NON-final record: the final record's prev references its hash,
                // so an in-place edit breaks the linkage (a final-record edit is only
                // catchable via the envelope head digest -- covered by the owning suite)
                const target = JSON.parse(lines[lines.length - 2] ?? '') as Record<string, unknown>;
                target.note = 'doctored';
                lines[lines.length - 2] = JSON.stringify(target);
                await fs.writeFile(opsPath, `${lines.join('\n')}\n`);

                const verdict = await verifyOpsChain(fixture.root, fixture.fs);
                assert.strictEqual(verdict.ok, false);
                assert.ok(verdict.problems.some(problem => /prev does not match the previous record's line hash/.test(problem.message)), 'the in-place tamper is named');

                // the owning verifier fails too
                const realOps = new ProvenanceLedger({ root: fixture.root, fs: nodeWorkspaceFs(), clock: fixture.clock });
                assert.strictEqual((await realOps.verifyChain()).ok, false);

                await fs.writeFile(opsPath, original);
                assert.strictEqual((await verifyOpsChain(fixture.root, fixture.fs)).ok, true, 'restored -> ok again');
        });

        test('an empty workspace (no durable state at all) verifies ok with zero rows', async () => {
                const emptyRoot = await fs.mkdtemp(path.join(path.sep, 'tmp', 'flauz-diag-empty-'));
                try {
                        const verdict = await collectIntegrity(emptyRoot, {
                                readFileUtf8: async () => undefined,
                                readdir: async () => undefined,
                                mkdir: async () => undefined,
                                writeFile: async () => undefined,
                        });
                        assert.strictEqual(verdict.evidenceLedger.ok, true);
                        assert.strictEqual(verdict.evidenceLedger.rows, 0);
                        assert.strictEqual(verdict.opsChain.ok, true);
                        assert.strictEqual(verdict.opsChain.records, 0);
                } finally {
                        await fs.rm(emptyRoot, { recursive: true, force: true });
                }
        });
});

/** A deterministic fixture signer (the flauz-workflow fixture-keystore posture; HMAC class). */
class FixtureSigner {
        readonly algorithm = 'hmac-sha256' as const;
        readonly keyId = 'fixture-key-1';

        async sign(rowSeq: number, headSha256: string): Promise<string> {
                const { createHmac } = await import('node:crypto');
                return createHmac('sha256', new TextEncoder().encode('flauz-diag-fixture-key')).update(`${String(rowSeq)}:${String(headSha256)}`).digest('hex');
        }

        async verify(): Promise<boolean> {
                return true;
        }
}
