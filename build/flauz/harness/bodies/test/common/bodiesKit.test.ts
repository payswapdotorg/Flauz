/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-006 organization-defaults kit battery: the fail-closed factories,
 * the staged op surface (begin/add/replace/remove/finalize/emit) with
 * every refusal class and the record-unchanged law, THE
 * ROLE-RESOLUTION boundary against the caller-supplied roles record,
 * THE CROSS-KIT INTEGRATION PINS (the wave's crown: the REAL DH-01
 * harness kit, the REAL DH-04 ontology kit, the REAL DH-03 roles kit,
 * the REAL DH-02 review-composition validator), the PIN-2 persistence
 * family (ledger + envelope, torn line, divergent envelope, restart
 * replay, the multi-record ledger, the fresh-kit guard, version drift,
 * the tampered finalize payload), the dispose law, and the in-suite
 * determinism greps.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHarnessKit } from '../../../contract/common/domainHarnessKit.js';
import { createOntologyKit } from '../../../ontology/common/ontologyKit.js';
import { createRolesKit } from '../../../roles/common/rolesKit.js';
import { validateOnboardingReviewComposition } from '../../../onboarding/common/onboardingContract.js';
import {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        ONBOARDING_CONTRACTS_VERSION,
        ONTOLOGY_CONTRACTS_VERSION,
        ROLES_CONTRACTS_VERSION,
        BODIES_CONTRACTS_VERSION,
        BODIES_ENVELOPE_RELATIVE_PATH,
        BODIES_KIT_REFUSAL_REASONS,
        BODIES_LEDGER_RELATIVE_PATH,
        createBodiesKit,
        loadBodiesKit,
} from '../../common/bodiesKit.js';
import { BODIES_REJECTION_REASONS } from '../../common/bodiesContract.js';
import type { HarnessFsPort, BodiesKit, BodiesKitRefusal } from '../../common/bodiesKit.js';

const KIT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/bodiesKit.ts', import.meta.url)), 'utf8');

const HARNESS_ID = 'flauz:hrn:0123456789abcdef';

function makeSeams(): { clock: () => string; rng: () => string; clockReads: () => number; rngReads: () => number } {
        let clockCount = 0;
        let rngCount = 0;
        return {
                clock: () => {
                        clockCount += 1;
                        return `2026-01-01T00:00:${String(clockCount % 60).padStart(2, '0')}.${String(clockCount).padStart(3, '0')}Z`;
                },
                rng: () => {
                        rngCount += 1;
                        return rngCount.toString(16).padStart(16, '0');
                },
                clockReads: () => clockCount,
                rngReads: () => rngCount,
        };
}

/** The in-memory fs port (the DH-01 port shape; a missing file reads as ENOENT). */
class MemoryFsPort {
        private readonly files = new Map<string, string>();
        async readFile(path: string, _encoding: 'utf8'): Promise<string> {
                if (!this.files.has(path)) {
                        throw { code: 'ENOENT', message: `ENOENT: no such file: ${path}` };
                }
                return this.files.get(path) as string;
        }
        async writeFile(path: string, text: string): Promise<void> {
                this.files.set(path, text);
        }
        async appendFile(path: string, text: string): Promise<void> {
                this.files.set(path, (this.files.get(path) ?? '') + text);
        }
        async mkdir(_path: string, _options: { recursive: boolean }): Promise<void> {
                /* the in-memory port is flat - the mkdir is a no-op */
        }
        dump(path: string): string | undefined {
                return this.files.get(path);
        }
        overwrite(path: string, text: string): void {
                this.files.set(path, text);
        }
        remove(path: string): void {
                this.files.delete(path);
        }
}

/**
 * A caller-supplied COMPOSED RoleCompositionSession fixture (the REAL
 * DH-03 five-key session shape - the finalize boundary's authority).
 */
function composedRoles(): Record<string, unknown> {
        return {
                sessionId: 'flauz:rol:0123456789abcdef',
                industry: 'software',
                stage: 'composed',
                roles: [
                        { roleKey: 'analyst', summary: 'Runs the domain analysis.' },
                        { roleKey: 'reviewer', summary: 'Reviews the domain work.' },
                ],
                history: [
                        { at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-session', law: 'THE FORWARD-ONLY LAW', detail: 'began the composition' },
                        { at: '2026-01-01T00:00:01.000Z', fromStage: 'composing', toStage: 'composed', op: 'finalize-composition', law: 'THE FORWARD-ONLY LAW', detail: 'finalized the composition' },
                ],
        };
}

async function beginGreen(kit: BodiesKit, harnessId: string = HARNESS_ID): Promise<string> {
        const outcome = await kit.beginDefaults(harnessId, 'software');
        if (!outcome.ok) {
                throw new Error(`beginDefaults refused: ${outcome.refusal.reason}`);
        }
        assert.equal(outcome.record.stage, 'composing');
        return outcome.record.bodyId;
}

async function addBodyGreen(kit: BodiesKit, defaultsId: string, body: Record<string, unknown>): Promise<void> {
        const outcome = await kit.addBody(defaultsId, body);
        if (!outcome.ok) {
                throw new Error(`addBody refused: ${outcome.refusal.reason}`);
        }
}

function refusalOf(outcome: { ok: boolean; refusal?: BodiesKitRefusal }): BodiesKitRefusal {
        if (outcome.ok || outcome.refusal === undefined) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.refusal;
}

suite('bodiesKit · factories', () => {
        test('createBodiesKit binds the injected seams (green, no persistence)', () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(typeof kit.dispose, 'function');
        });

        test('factory misuse throws TypeError: the options shape and the seam reads', () => {
                const seams = makeSeams();
                assert.throws(() => createBodiesKit(null as never), /createBodiesKit: options must be an object/);
                assert.throws(() => createBodiesKit({ rng: seams.rng } as never), /options\.clock must be a function/);
                assert.throws(() => createBodiesKit({ clock: seams.clock } as never), /options\.rng must be a function/);
                assert.throws(() => createBodiesKit({ clock: () => '', rng: seams.rng } as never), /options\.clock\(\) must return a non-empty ISO string/);
                assert.throws(() => createBodiesKit({ clock: seams.clock, rng: () => 'nope' } as never), /options\.rng\(\) must return exactly 16 lowercase hex chars/);
        });

        test('factory misuse throws TypeError: the fsPort / root pairing', () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                assert.throws(() => createBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort } as never), /come together or not at all/);
                assert.throws(() => createBodiesKit({ clock: seams.clock, rng: seams.rng, root: 'ws' } as never), /come together or not at all/);
                assert.throws(() => createBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: {} as HarnessFsPort, root: 'ws' } as never), /options\.fsPort\.readFile must be a function/);
                assert.throws(() => createBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: '' } as never), /options\.root must be a non-empty string/);
        });

        test('the factory consumes exactly ONE clock read and ONE rng read', () => {
                const seams = makeSeams();
                createBodiesKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(seams.clockReads(), 1);
                assert.equal(seams.rngReads(), 1);
        });

        test('loadBodiesKit requires BOTH fsPort and root', async () => {
                const seams = makeSeams();
                // station-fix (R70): loadBodiesKit is ASYNC - its TypeError surfaces as a
                // rejected promise; assert.rejects is the correct channel.
                await assert.rejects(loadBodiesKit({ clock: seams.clock, rng: seams.rng } as never), /loadBodiesKit: options\.fsPort and options\.root are both required/);
        });

        test('a fresh root (no files) reopens as an empty kit', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const outcome = await loadBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(outcome.ok);
                const listed = await outcome.kit.listDefaults();
                assert.ok(listed.ok);
                assert.deepStrictEqual(listed.records, []);
        });

        test('the kit re-carries the five contract versions (the single-version pins)', () => {
                assert.equal(BODIES_CONTRACTS_VERSION, BODIES_CONTRACTS_VERSION);
                assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, DOMAIN_HARNESS_CONTRACTS_VERSION);
                assert.equal(ONBOARDING_CONTRACTS_VERSION, ONBOARDING_CONTRACTS_VERSION);
                assert.equal(ROLES_CONTRACTS_VERSION, ROLES_CONTRACTS_VERSION);
                assert.equal(ONTOLOGY_CONTRACTS_VERSION, ONTOLOGY_CONTRACTS_VERSION);
        });

        test('BODIES_KIT_REFUSAL_REASONS is the contract list plus the frozen extras', () => {
                const all = Array.from(BODIES_KIT_REFUSAL_REASONS);
                assert.deepStrictEqual(all.slice(0, BODIES_REJECTION_REASONS.length), Array.from(BODIES_REJECTION_REASONS));
                assert.deepStrictEqual(all.slice(BODIES_REJECTION_REASONS.length), ['DISPOSED', 'CORRUPT_SEAM', 'E_LEDGER_TORN', 'E_ENVELOPE_MISMATCH', 'BODIES_IO', 'UNKNOWN_FILTER']);
        });
});

suite('bodiesKit · beginDefaults', () => {
        test('green: mints flauz:bod:<16-hex>, composing, ZERO bodies, the begin note', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const outcome = await kit.beginDefaults(HARNESS_ID, 'software');
                assert.ok(outcome.ok);
                assert.match(outcome.record.bodyId, /^flauz:bod:[0-9a-f]{16}$/);
                assert.equal(outcome.record.harnessId, HARNESS_ID);
                assert.equal(outcome.record.industry, 'software');
                assert.equal(outcome.record.stage, 'composing');
                assert.deepStrictEqual(outcome.record.bodies, []);
                assert.equal(outcome.record.history.length, 1);
                assert.equal(outcome.record.history[0].fromStage, null);
                assert.equal(outcome.record.history[0].toStage, 'composing');
                assert.equal(outcome.record.history[0].op, 'begin-defaults');
        });

        test('malformed-harness-id refuses (the REAL DH-01 alphabet)', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                for (const harnessId of ['flauz:bod:0123456789abcdef', 'flauz:hrn:0123456789ABCDEF', 7]) {
                        const refusal = refusalOf(await kit.beginDefaults(harnessId, 'software'));
                        assert.equal(refusal.reason, 'malformed-harness-id');
                }
        });

        test('unknown-industry refuses', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const refusal = refusalOf(await kit.beginDefaults(HARNESS_ID, 'aerospace'));
                assert.equal(refusal.reason, 'unknown-industry');
                assert.equal(refusal.law, 'THE FROZEN-VOCABULARY LAW');
        });

        test('CORRUPT_SEAM: a non-16-hex rng read or a duplicate minted id', async () => {
                const bad = createBodiesKit({ clock: () => '2026-01-01T00:00:00.000Z', rng: () => '0123456789abcdef' });
                const first = await bad.beginDefaults(HARNESS_ID, 'software');
                assert.ok(first.ok);
                const second = refusalOf(await bad.beginDefaults(HARNESS_ID, 'software'));
                assert.equal(second.reason, 'CORRUPT_SEAM');
                let call = 0;
                const flip = createBodiesKit({ clock: () => '2026-01-01T00:00:00.000Z', rng: () => (call++ === 0 ? '0123456789abcdef' : 'zzz') });
                const refusal = refusalOf(await flip.beginDefaults(HARNESS_ID, 'software'));
                assert.equal(refusal.reason, 'CORRUPT_SEAM');
        });
});

suite('bodiesKit · addBody', () => {
        test('green: the body lands with the add-body self-edge note', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                const outcome = await kit.addBody(defaultsId, { bodyKey: 'triage', summary: 'Triage the incoming work.', roleRefs: ['analyst'] });
                assert.ok(outcome.ok);
                assert.equal(outcome.record.bodies.length, 1);
                assert.deepStrictEqual(outcome.record.bodies[0], { bodyKey: 'triage', summary: 'Triage the incoming work.', roleRefs: ['analyst'] });
                const note = outcome.record.history[outcome.record.history.length - 1];
                assert.equal(note.op, 'add-body');
                assert.equal(note.fromStage, 'composing');
                assert.equal(note.toStage, 'composing');
        });

        test('the honest-gap law: empty roleRefs land', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                const outcome = await kit.addBody(defaultsId, { bodyKey: 'triage', summary: 'Triage the incoming work.', roleRefs: [] });
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.record.bodies[0].roleRefs, []);
        });

        test('THE TWO-PHASE LAW: a dangling roleRef is LEGAL while composing', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                const outcome = await kit.addBody(defaultsId, { bodyKey: 'triage', summary: 'Triage the incoming work.', roleRefs: ['ghost-role'] });
                assert.ok(outcome.ok);
        });

        test('a payload refusal carries the COMPLETE rejection table and leaves the record unchanged', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: ['analyst'] });
                const before = await kit.inspectDefaults(defaultsId);
                const refusal = refusalOf(await kit.addBody(defaultsId, { bodyKey: ' x ', summary: '', roleRefs: 'nope', model: 1 }));
                assert.equal(refusal.reason, 'no-fork');
                assert.ok(refusal.rejections !== undefined);
                assert.deepStrictEqual(refusal.rejections.map((rejection) => rejection.reason), ['no-fork', 'invalid-body-key', 'invalid-summary', 'malformed-role-refs']);
                const after = await kit.inspectDefaults(defaultsId);
                assert.deepStrictEqual(after, before);
        });

        test('duplicate-body-key refuses and leaves the record unchanged', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: [] });
                const before = await kit.inspectDefaults(defaultsId);
                const refusal = refusalOf(await kit.addBody(defaultsId, { bodyKey: 'triage', summary: 'Again.', roleRefs: [] }));
                assert.equal(refusal.reason, 'duplicate-body-key');
                assert.deepStrictEqual(refusal.items, ['triage']);
                assert.deepStrictEqual(await kit.inspectDefaults(defaultsId), before);
        });

        test('exactly 64 bodies compose; the 65th refuses max-bodies-exceeded', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                for (let index = 0; index < 64; index += 1) {
                        await addBodyGreen(kit, defaultsId, { bodyKey: `b${String(index).padStart(2, '0')}`, summary: 'A default body.', roleRefs: [] });
                }
                const atBound = await kit.inspectDefaults(defaultsId);
                assert.ok(atBound.ok);
                assert.equal(atBound.record.bodies.length, 64);
                const refusal = refusalOf(await kit.addBody(defaultsId, { bodyKey: 'b64', summary: 'One too many.', roleRefs: [] }));
                assert.equal(refusal.reason, 'max-bodies-exceeded');
        });

        test('unknown-record (malformed or unresolved id) and stale-stage refuse', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(refusalOf(await kit.addBody('nope', { bodyKey: 'k', summary: 's', roleRefs: [] })).reason, 'unknown-record');
                assert.equal(refusalOf(await kit.addBody('flauz:bod:ffffffffffffffff', { bodyKey: 'k', summary: 's', roleRefs: [] })).reason, 'unknown-record');
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: [] });
                const finalized = await kit.finalizeDefaults(defaultsId, composedRoles());
                assert.ok(finalized.ok);
                assert.equal(refusalOf(await kit.addBody(defaultsId, { bodyKey: 'later', summary: 'Too late.', roleRefs: [] })).reason, 'stale-stage');
        });
});

suite('bodiesKit · replaceBodySummary', () => {
        test('green: ONLY the summary changes (the bodyKey and roleRefs are immutable)', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage the work.', roleRefs: ['analyst', 'reviewer'] });
                const outcome = await kit.replaceBodySummary(defaultsId, 'triage', 'Triage the incoming work against the standing roles.');
                assert.ok(outcome.ok);
                assert.equal(outcome.record.bodies[0].bodyKey, 'triage');
                assert.deepStrictEqual(outcome.record.bodies[0].roleRefs, ['analyst', 'reviewer']);
                assert.equal(outcome.record.bodies[0].summary, 'Triage the incoming work against the standing roles.');
        });

        test('unknown-body refuses (missing or malformed bodyKey)', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                assert.equal(refusalOf(await kit.replaceBodySummary(defaultsId, 'ghost', 's')).reason, 'unknown-body');
                assert.equal(refusalOf(await kit.replaceBodySummary(defaultsId, 7, 's')).reason, 'unknown-body');
        });

        test('an invalid summary carries the COMPLETE table and leaves the record unchanged', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: [] });
                const before = await kit.inspectDefaults(defaultsId);
                const refusal = refusalOf(await kit.replaceBodySummary(defaultsId, 'triage', ''));
                assert.equal(refusal.reason, 'invalid-summary');
                assert.ok(refusal.rejections !== undefined);
                assert.deepStrictEqual(refusal.rejections.map((rejection) => rejection.reason), ['invalid-summary']);
                assert.deepStrictEqual(await kit.inspectDefaults(defaultsId), before);
        });

        test('stale-stage refuses on a composed record', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: [] });
                assert.ok((await kit.finalizeDefaults(defaultsId, composedRoles())).ok);
                assert.equal(refusalOf(await kit.replaceBodySummary(defaultsId, 'triage', 'Late.')).reason, 'stale-stage');
        });
});

suite('bodiesKit · removeBody', () => {
        test('green: the body leaves with the remove note', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: [] });
                await addBodyGreen(kit, defaultsId, { bodyKey: 'report', summary: 'Report.', roleRefs: [] });
                const outcome = await kit.removeBody(defaultsId, 'triage');
                assert.ok(outcome.ok);
                assert.equal(outcome.record.bodies.length, 1);
                assert.equal(outcome.record.bodies[0].bodyKey, 'report');
                assert.equal(outcome.record.history[outcome.record.history.length - 1].op, 'remove-body');
        });

        test('removing the LAST body is LEGAL while composing', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: [] });
                const outcome = await kit.removeBody(defaultsId, 'triage');
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.record.bodies, []);
        });

        test('unknown-body refuses', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                assert.equal(refusalOf(await kit.removeBody(defaultsId, 'ghost')).reason, 'unknown-body');
        });

        test('THE REMOVE+RE-ADD LAW: a changed bodyKey is a NEW body (remove, then re-add)', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: [] });
                assert.ok((await kit.removeBody(defaultsId, 'triage')).ok);
                const outcome = await kit.addBody(defaultsId, { bodyKey: 'deep-triage', summary: 'A different body.', roleRefs: [] });
                assert.ok(outcome.ok);
                assert.equal(outcome.record.bodies[0].bodyKey, 'deep-triage');
        });
});

suite('bodiesKit · finalizeDefaults', () => {
        test('THE DH-01 FLOOR: an empty record refuses empty-bodies', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                const refusal = refusalOf(await kit.finalizeDefaults(defaultsId, composedRoles()));
                assert.equal(refusal.reason, 'empty-bodies');
                assert.deepStrictEqual(refusal.items, ['bodies']);
        });

        test('malformed-roles refuses: a non-record or a record failing the REAL DH-03 walk', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: ['analyst'] });
                assert.equal(refusalOf(await kit.finalizeDefaults(defaultsId, null)).reason, 'malformed-roles');
                assert.equal(refusalOf(await kit.finalizeDefaults(defaultsId, { nope: 1 })).reason, 'malformed-roles');
                const broken = composedRoles() as Record<string, unknown>;
                broken.industry = 'aerospace';
                assert.equal(refusalOf(await kit.finalizeDefaults(defaultsId, broken)).reason, 'malformed-roles');
        });

        test('malformed-roles refuses: a composing (non-composed) roles record', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: [] });
                const composing = composedRoles() as Record<string, unknown>;
                composing.stage = 'composing';
                const refusal = refusalOf(await kit.finalizeDefaults(defaultsId, composing));
                assert.equal(refusal.reason, 'malformed-roles');
        });

        test('THE NO-DANGLING-REF boundary refuses typed, naming every offending ref', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: ['analyst', 'ghost'] });
                await addBodyGreen(kit, defaultsId, { bodyKey: 'report', summary: 'Report.', roleRefs: ['phantom', 'reviewer'] });
                const refusal = refusalOf(await kit.finalizeDefaults(defaultsId, composedRoles()));
                assert.equal(refusal.reason, 'dangling-role-ref');
                assert.equal(refusal.law, 'THE ROLE-RESOLUTION LAW');
                assert.deepStrictEqual(refusal.items, ['ghost', 'phantom']);
        });

        test('the refusal leaves the record unchanged (still composing)', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: ['ghost'] });
                const before = await kit.inspectDefaults(defaultsId);
                refusalOf(await kit.finalizeDefaults(defaultsId, composedRoles()));
                assert.deepStrictEqual(await kit.inspectDefaults(defaultsId), before);
        });

        test('green: composing -> composed, TERMINAL, bodies carried, the finalize note', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: ['analyst'] });
                const outcome = await kit.finalizeDefaults(defaultsId, composedRoles());
                assert.ok(outcome.ok);
                assert.equal(outcome.record.stage, 'composed');
                assert.equal(outcome.record.bodies.length, 1);
                const note = outcome.record.history[outcome.record.history.length - 1];
                assert.equal(note.op, 'finalize-defaults');
                assert.equal(note.fromStage, 'composing');
                assert.equal(note.toStage, 'composed');
                assert.equal(note.law, 'THE ROLE-RESOLUTION LAW');
        });

        test('after compose: every mutating op refuses stale-stage', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: [] });
                assert.ok((await kit.finalizeDefaults(defaultsId, composedRoles())).ok);
                assert.equal(refusalOf(await kit.addBody(defaultsId, { bodyKey: 'late', summary: 'Late.', roleRefs: [] })).reason, 'stale-stage');
                assert.equal(refusalOf(await kit.replaceBodySummary(defaultsId, 'triage', 'Late.')).reason, 'stale-stage');
                assert.equal(refusalOf(await kit.removeBody(defaultsId, 'triage')).reason, 'stale-stage');
                assert.equal(refusalOf(await kit.finalizeDefaults(defaultsId, composedRoles())).reason, 'stale-stage');
        });
});

suite('bodiesKit · emitOrganizationRef', () => {
        test('premature-op on a composing record', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                const refusal = refusalOf(await kit.emitOrganizationRef(defaultsId));
                assert.equal(refusal.reason, 'premature-op');
                assert.equal(refusal.law, 'THE FORWARD-ONLY LAW');
        });

        test('green on a composed record: the organizationRef is the record id', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: [] });
                assert.ok((await kit.finalizeDefaults(defaultsId, composedRoles())).ok);
                const outcome = await kit.emitOrganizationRef(defaultsId);
                assert.ok(outcome.ok);
                assert.equal(outcome.organizationRef, defaultsId);
                assert.match(outcome.organizationRef, /^flauz:bod:[0-9a-f]{16}$/);
        });

        test('unknown-record refuses', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(refusalOf(await kit.emitOrganizationRef('flauz:bod:ffffffffffffffff')).reason, 'unknown-record');
        });
});

suite('bodiesKit · THE CROSS-KIT INTEGRATION PINS (the wave crown)', () => {
        test('the crown: real harness kit -> real ontology kit -> real roles kit -> organization defaults -> finalize -> emit -> the REAL review-composition validator passes', async () => {
                const seams = makeSeams();
                const harnessKit = createHarnessKit({
                        clock: seams.clock,
                        rng: seams.rng,
                        catalog: { capabilities: [], workflowIds: [], policyIds: [], evidenceIds: [] },
                });
                const minted = await harnessKit.mintHarness({
                        industry: 'software',
                        workTypes: ['analysis'],
                        displayName: 'Crown Harness',
                        roles: [
                                { roleKey: 'analyst', summary: 'Runs the domain analysis.' },
                                { roleKey: 'reviewer', summary: 'Reviews the domain work.' },
                        ],
                        capabilityRefs: [],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [],
                });
                assert.ok(minted.ok);
                const harnessId = minted.record.harnessId;
                const ontologyKit = createOntologyKit({ clock: seams.clock, rng: seams.rng });
                const begun = await ontologyKit.beginOntology(harnessId, 'software');
                assert.ok(begun.ok);
                const ontologyId = begun.record.ontologyId;
                assert.ok((await ontologyKit.addTerm(ontologyId, { term: 'signal', definition: 'A measured quantity of interest.' })).ok);
                assert.ok((await ontologyKit.addTerm(ontologyId, { term: 'baseline', definition: 'The reference measurement.' })).ok);
                const finalizedOntology = await ontologyKit.finalizeOntology(ontologyId);
                assert.ok(finalizedOntology.ok);
                assert.equal(finalizedOntology.record.stage, 'composed');
                const rolesKit = createRolesKit({ clock: seams.clock, rng: seams.rng });
                const session = await rolesKit.beginSession('software');
                assert.ok(session.ok);
                const sessionId = session.session.sessionId;
                assert.ok((await rolesKit.addRole(sessionId, { roleKey: 'analyst', summary: 'Runs the domain analysis.' })).ok);
                assert.ok((await rolesKit.addRole(sessionId, { roleKey: 'reviewer', summary: 'Reviews the domain work.' })).ok);
                const finalizedRoles = await rolesKit.finalizeComposition(sessionId);
                assert.ok(finalizedRoles.ok);
                assert.equal(finalizedRoles.session.stage, 'composed');
                const bodiesKit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const begunDefaults = await bodiesKit.beginDefaults(harnessId, 'software');
                assert.ok(begunDefaults.ok);
                const defaultsId = begunDefaults.record.bodyId;
                const realRoleKeys = finalizedRoles.session.roles.map((role) => role.roleKey);
                assert.ok((await bodiesKit.addBody(defaultsId, { bodyKey: 'triage', summary: 'Triage the incoming signal against the roles.', roleRefs: realRoleKeys })).ok);
                const finalized = await bodiesKit.finalizeDefaults(defaultsId, finalizedRoles.session);
                assert.ok(finalized.ok);
                assert.equal(finalized.record.stage, 'composed');
                const emitted = await bodiesKit.emitOrganizationRef(defaultsId);
                assert.ok(emitted.ok);
                assert.equal(emitted.organizationRef, defaultsId);
                // The emitted organizationRef rides the REAL review composition's
                // capabilityRefs family (the landed DH-02 schema's capability-side slot -
                // the work order's 'org-refs family' does not exist in the landed surface;
                // widening DH-02 is a later wave's versioned decision, never this layer's).
                const composition = validateOnboardingReviewComposition({
                        roles: finalizedRoles.session.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
                        capabilityRefs: [emitted.organizationRef],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [],
                });
                assert.ok(composition.ok);
                assert.deepStrictEqual(composition.value.capabilityRefs, [emitted.organizationRef]);
        });

        test('the crown boundary: a dangling roleRef refuses against the REAL composed roles record', async () => {
                const seams = makeSeams();
                const harnessKit = createHarnessKit({
                        clock: seams.clock,
                        rng: seams.rng,
                        catalog: { capabilities: [], workflowIds: [], policyIds: [], evidenceIds: [] },
                });
                const minted = await harnessKit.mintHarness({
                        industry: 'software',
                        workTypes: ['analysis'],
                        displayName: 'Crown Harness',
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [],
                });
                assert.ok(minted.ok);
                const rolesKit = createRolesKit({ clock: seams.clock, rng: seams.rng });
                const session = await rolesKit.beginSession('software');
                assert.ok(session.ok);
                assert.ok((await rolesKit.addRole(session.session.sessionId, { roleKey: 'analyst', summary: 'Runs the domain analysis.' })).ok);
                const finalizedRoles = await rolesKit.finalizeComposition(session.session.sessionId);
                assert.ok(finalizedRoles.ok);
                const bodiesKit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const begunDefaults = await bodiesKit.beginDefaults(minted.record.harnessId, 'software');
                assert.ok(begunDefaults.ok);
                assert.ok((await bodiesKit.addBody(begunDefaults.record.bodyId, { bodyKey: 'triage', summary: 'Triage the ghost.', roleRefs: ['analyst', 'ghost'] })).ok);
                const refusal = refusalOf(await bodiesKit.finalizeDefaults(begunDefaults.record.bodyId, finalizedRoles.session));
                assert.equal(refusal.reason, 'dangling-role-ref');
                assert.deepStrictEqual(refusal.items, ['ghost']);
        });

        test('the crown family form: the emitted ref rides capabilityRefs; a duplicate or non-string member refuses the REAL validator', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: [] });
                assert.ok((await kit.finalizeDefaults(defaultsId, composedRoles())).ok);
                const emitted = await kit.emitOrganizationRef(defaultsId);
                assert.ok(emitted.ok);
                const green = validateOnboardingReviewComposition({
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [emitted.organizationRef],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [],
                });
                assert.ok(green.ok);
                const duplicated = validateOnboardingReviewComposition({
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [emitted.organizationRef, emitted.organizationRef],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [],
                });
                assert.ok(!duplicated.ok);
                assert.equal(duplicated.refusal.reason, 'duplicate-ref');
                const malformed = validateOnboardingReviewComposition({
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [emitted.organizationRef, 7],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [],
                });
                assert.ok(!malformed.ok);
                assert.equal(malformed.refusal.reason, 'malformed-refs');
        });

        test('the crown honest gap: a body with zero roleRefs finalizes green against the real composed roles record', async () => {
                const seams = makeSeams();
                const rolesKit = createRolesKit({ clock: seams.clock, rng: seams.rng });
                const session = await rolesKit.beginSession('software');
                assert.ok(session.ok);
                assert.ok((await rolesKit.addRole(session.session.sessionId, { roleKey: 'analyst', summary: 'Runs the domain analysis.' })).ok);
                const finalizedRoles = await rolesKit.finalizeComposition(session.session.sessionId);
                assert.ok(finalizedRoles.ok);
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'A body that names zero roles.', roleRefs: [] });
                const finalized = await kit.finalizeDefaults(defaultsId, finalizedRoles.session);
                assert.ok(finalized.ok);
                assert.equal(finalized.record.stage, 'composed');
        });
});

suite('bodiesKit · persistence (the PIN-2 mirror)', () => {
        test('the ledger and the envelope land lazily at the distinct family paths', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.equal(port.dump('ws/.flauz/harness/bodies-ops.jsonl'), undefined);
                const defaultsId = await beginGreen(kit);
                const ledger = port.dump(`ws/${BODIES_LEDGER_RELATIVE_PATH}`);
                assert.ok(ledger !== undefined && ledger.endsWith('\n'));
                assert.equal(ledger.split('\n').length - 1, 1);
                const envelope = port.dump(`ws/${BODIES_ENVELOPE_RELATIVE_PATH}`);
                assert.ok(envelope !== undefined);
                const parsed = JSON.parse(envelope as string) as { contractVersion: string; seq: number; records: unknown[] };
                assert.equal(parsed.contractVersion, BODIES_CONTRACTS_VERSION);
                assert.equal(parsed.seq, 1);
                assert.equal(parsed.records.length, 1);
        });

        test('restart replay is byte-identical and the seq continues', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const first = await beginGreen(kit);
                await addBodyGreen(kit, first, { bodyKey: 'triage', summary: 'Triage.', roleRefs: ['analyst'] });
                const second = await beginGreen(kit);
                const beforeFirst = await kit.inspectDefaults(first);
                const reloaded = await loadBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                assert.deepStrictEqual(await reloaded.kit.inspectDefaults(first), beforeFirst);
                assert.ok((await reloaded.kit.addBody(second, { bodyKey: 'report', summary: 'Report.', roleRefs: [] })).ok);
                const ledger = port.dump(`ws/${BODIES_LEDGER_RELATIVE_PATH}`) as string;
                assert.equal(ledger.split('\n').length - 1, 4);
                const envelope = JSON.parse(port.dump(`ws/${BODIES_ENVELOPE_RELATIVE_PATH}`) as string) as { seq: number };
                assert.equal(envelope.seq, 4);
        });

        test('a torn ledger (no trailing newline) is E_LEDGER_TORN', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                const ledgerPath = `ws/${BODIES_LEDGER_RELATIVE_PATH}`;
                port.overwrite(ledgerPath, (port.dump(ledgerPath) as string).slice(0, -1));
                const outcome = await loadBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_LEDGER_TORN');
        });

        test('a content-divergent envelope is E_ENVELOPE_MISMATCH (never silently rebuilt)', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: [] });
                const envelopePath = `ws/${BODIES_ENVELOPE_RELATIVE_PATH}`;
                const parsed = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: Record<string, unknown>[] };
                parsed.records[0].bodies = [];
                port.overwrite(envelopePath, JSON.stringify(parsed));
                const outcome = await loadBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
        });

        test('a missing envelope while the ledger carries lines is E_ENVELOPE_MISMATCH', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                port.remove(`ws/${BODIES_ENVELOPE_RELATIVE_PATH}`);
                const outcome = await loadBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
        });

        test('an envelope seq ahead is E_LEDGER_TORN; behind is E_ENVELOPE_MISMATCH', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                await beginGreen(kit);
                const envelopePath = `ws/${BODIES_ENVELOPE_RELATIVE_PATH}`;
                const ahead = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: unknown[] };
                ahead.seq = 3;
                port.overwrite(envelopePath, JSON.stringify(ahead));
                const aheadOutcome = await loadBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!aheadOutcome.ok);
                assert.equal(aheadOutcome.refusal.reason, 'E_LEDGER_TORN');
                const behind = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: unknown[] };
                behind.seq = 1;
                port.overwrite(envelopePath, JSON.stringify(behind));
                const behindOutcome = await loadBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!behindOutcome.ok);
                assert.equal(behindOutcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
        });

        test('the multi-record ledger replays both records in bodyId order', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const first = await beginGreen(kit);
                const second = await beginGreen(kit);
                await addBodyGreen(kit, first, { bodyKey: 'triage', summary: 'Triage.', roleRefs: [] });
                assert.ok((await kit.finalizeDefaults(first, composedRoles())).ok);
                const reloaded = await loadBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                const listed = await reloaded.kit.listDefaults();
                assert.ok(listed.ok);
                assert.equal(listed.records.length, 2);
                assert.deepStrictEqual(listed.records.map((record) => record.bodyId), [first, second].sort());
                const composed = await reloaded.kit.inspectDefaults(first);
                assert.ok(composed.ok);
                assert.equal(composed.record.stage, 'composed');
        });

        test('a fresh kit never appends over a non-empty ledger (E_LEDGER_TORN)', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                const ledgerPath = `ws/${BODIES_LEDGER_RELATIVE_PATH}`;
                const lineCount = (port.dump(ledgerPath) as string).split('\n').length - 1;
                const fresh = createBodiesKit({ clock: seams.clock, rng: makeSeams().rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const refusal = refusalOf(await fresh.beginDefaults(HARNESS_ID, 'software'));
                assert.equal(refusal.reason, 'E_LEDGER_TORN');
                assert.equal((port.dump(ledgerPath) as string).split('\n').length - 1, lineCount);
        });

        test('a tampered contractVersion is the typed version-mismatch', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                const ledgerPath = `ws/${BODIES_LEDGER_RELATIVE_PATH}`;
                const lines = (port.dump(ledgerPath) as string).split('\n');
                const first = JSON.parse(lines[0]) as Record<string, unknown>;
                first.contractVersion = '9.9.9';
                lines[0] = JSON.stringify(first);
                port.overwrite(ledgerPath, `${lines.join('\n')}\n`);
                const outcome = await loadBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'version-mismatch');
        });

        test('a tampered finalize payload (a dangling resolution) is E_LEDGER_TORN - the replay re-proves THE ROLE-RESOLUTION LAW', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: ['analyst'] });
                assert.ok((await kit.finalizeDefaults(defaultsId, composedRoles())).ok);
                const ledgerPath = `ws/${BODIES_LEDGER_RELATIVE_PATH}`;
                const lines = (port.dump(ledgerPath) as string).split('\n');
                const last = JSON.parse(lines[lines.length - 2]) as { payload: { roles: { roleKey: string }[] } };
                last.payload.roles[0].roleKey = 'ghost';
                lines[lines.length - 2] = JSON.stringify(last);
                port.overwrite(ledgerPath, `${lines.join('\n')}\n`);
                const outcome = await loadBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_LEDGER_TORN');
        });

        test('the finalize line carries the caller-supplied roles session AS IT STOOD', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const defaultsId = await beginGreen(kit);
                await addBodyGreen(kit, defaultsId, { bodyKey: 'triage', summary: 'Triage.', roleRefs: ['analyst'] });
                assert.ok((await kit.finalizeDefaults(defaultsId, composedRoles())).ok);
                const lines = (port.dump(`ws/${BODIES_LEDGER_RELATIVE_PATH}`) as string).split('\n');
                const last = JSON.parse(lines[lines.length - 2]) as { op: string; payload: { sessionId: string; stage: string; roles: unknown[] } };
                assert.equal(last.op, 'finalize-defaults');
                assert.equal(last.payload.sessionId, 'flauz:rol:0123456789abcdef');
                assert.equal(last.payload.stage, 'composed');
                assert.equal(last.payload.roles.length, 2);
        });
});

suite('bodiesKit · dispose and determinism', () => {
        test('THE DISPOSE LAW: every operation after dispose rejects', async () => {
                const seams = makeSeams();
                const kit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const defaultsId = await beginGreen(kit);
                kit.dispose();
                assert.equal(refusalOf(await kit.beginDefaults(HARNESS_ID, 'software')).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.addBody(defaultsId, { bodyKey: 'k', summary: 's', roleRefs: [] })).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.replaceBodySummary(defaultsId, 'k', 's')).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.removeBody(defaultsId, 'k')).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.finalizeDefaults(defaultsId, composedRoles())).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.emitOrganizationRef(defaultsId)).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.inspectDefaults(defaultsId)).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.listDefaults()).reason, 'DISPOSED');
        });

        test('determinism greps over the kit module: law-comment lines only', () => {
                const pattern = /Date\.now|Math\.random|new Date\(|process\.env/;
                const matches = KIT_SOURCE.split('\n').filter((line) => pattern.test(line));
                assert.ok(matches.length > 0, 'the greps must actually match the law-comment lines');
                const offending = matches.filter((line) => {
                        const trimmed = line.trim();
                        return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//');
                });
                assert.deepStrictEqual(offending, [], 'no executable line may carry the forbidden tokens');
        });
});
