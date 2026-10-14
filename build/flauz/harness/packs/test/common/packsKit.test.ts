/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-007 capability-packs kit battery: the fail-closed factories, the
 * staged op surface (begin/add/replace/remove/finalize/emit) with
 * every refusal class and the record-unchanged law, THE
 * BODY-RESOLUTION boundary against the caller-supplied bodies record
 * (the REAL DH-06 walk), THE CROSS-KIT INTEGRATION PINS (the wave's
 * crown: the REAL DH-01 harness kit -> the REAL DH-03 roles kit ->
 * the REAL DH-06 bodies kit -> this kit -> the REAL DH-02
 * review-composition validator), the PIN-2 persistence family
 * (ledger + envelope, torn line, divergent envelope, restart replay,
 * the multi-record ledger, the fresh-kit guard, version drift, the
 * tampered finalize payload), the frozen-record determinism, the
 * dispose law, and the in-suite determinism greps.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHarnessKit } from '../../../contract/common/domainHarnessKit.js';
import { createRolesKit } from '../../../roles/common/rolesKit.js';
import { createBodiesKit } from '../../../bodies/common/bodiesKit.js';
import { validateOnboardingReviewComposition } from '../../../onboarding/common/onboardingContract.js';
import {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        ONBOARDING_CONTRACTS_VERSION,
        ONTOLOGY_CONTRACTS_VERSION,
        ROLES_CONTRACTS_VERSION,
        TEMPLATES_CONTRACTS_VERSION,
        BODIES_CONTRACTS_VERSION,
        PACKS_CONTRACTS_VERSION,
        PACKS_ENVELOPE_RELATIVE_PATH,
        PACKS_KIT_REFUSAL_REASONS,
        PACKS_LEDGER_LINE_SCHEMA_KEYS,
        PACKS_LEDGER_RELATIVE_PATH,
        createPacksKit,
        loadPacksKit,
} from '../../common/packsKit.js';
import { PACKS_REJECTION_REASONS, serializeCapabilityPacksRecord } from '../../common/packsContract.js';
import type { HarnessFsPort, PacksKit, PacksKitRefusal } from '../../common/packsKit.js';

const KIT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/packsKit.ts', import.meta.url)), 'utf8');

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
 * A caller-supplied COMPOSED OrganizationDefaultsRecord fixture (the
 * REAL DH-06 six-key record shape - the finalize boundary's
 * authority).
 */
function composedBodies(): Record<string, unknown> {
        return {
                bodyId: 'flauz:bod:0123456789abcdef',
                harnessId: 'flauz:hrn:0123456789abcdef',
                industry: 'software',
                stage: 'composed',
                bodies: [
                        { bodyKey: 'triage', summary: 'Triage the incoming work.', roleRefs: ['analyst'] },
                        { bodyKey: 'report', summary: 'Report the outcomes.', roleRefs: ['reviewer'] },
                ],
                history: [
                        { at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-defaults', law: 'THE FORWARD-ONLY LAW', detail: 'began the record' },
                        { at: '2026-01-01T00:00:01.000Z', fromStage: 'composing', toStage: 'composed', op: 'finalize-defaults', law: 'THE ROLE-RESOLUTION LAW', detail: 'finalized the record' },
                ],
        };
}

async function beginGreen(kit: PacksKit, harnessId: string = HARNESS_ID): Promise<string> {
        const outcome = await kit.beginPacks(harnessId, 'software');
        if (!outcome.ok) {
                throw new Error(`beginPacks refused: ${outcome.refusal.reason}`);
        }
        assert.equal(outcome.record.stage, 'composing');
        return outcome.record.id;
}

async function addPackGreen(kit: PacksKit, packsId: string, pack: Record<string, unknown>): Promise<void> {
        const outcome = await kit.addPack(packsId, pack);
        if (!outcome.ok) {
                throw new Error(`addPack refused: ${outcome.refusal.reason}`);
        }
}

function refusalOf(outcome: { ok: boolean; refusal?: PacksKitRefusal }): PacksKitRefusal {
        if (outcome.ok || outcome.refusal === undefined) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.refusal;
}

suite('packsKit · factories', () => {
        test('createPacksKit binds the injected seams (green, no persistence)', () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(typeof kit.dispose, 'function');
        });

        test('factory misuse throws TypeError: the options shape and the seam reads', () => {
                const seams = makeSeams();
                assert.throws(() => createPacksKit(null as never), /createPacksKit: options must be an object/);
                assert.throws(() => createPacksKit({ rng: seams.rng } as never), /options\.clock must be a function/);
                assert.throws(() => createPacksKit({ clock: seams.clock } as never), /options\.rng must be a function/);
                assert.throws(() => createPacksKit({ clock: () => '', rng: seams.rng } as never), /options\.clock\(\) must return a non-empty ISO string/);
                assert.throws(() => createPacksKit({ clock: seams.clock, rng: () => 'nope' } as never), /options\.rng\(\) must return exactly 16 lowercase hex chars/);
        });

        test('factory misuse throws TypeError: the fsPort / root pairing', () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                assert.throws(() => createPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort } as never), /come together or not at all/);
                assert.throws(() => createPacksKit({ clock: seams.clock, rng: seams.rng, root: 'ws' } as never), /come together or not at all/);
                assert.throws(() => createPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: {} as HarnessFsPort, root: 'ws' } as never), /options\.fsPort\.readFile must be a function/);
                assert.throws(() => createPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: '' } as never), /options\.root must be a non-empty string/);
        });

        test('the factory consumes exactly ONE clock read and ONE rng read', () => {
                const seams = makeSeams();
                createPacksKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(seams.clockReads(), 1);
                assert.equal(seams.rngReads(), 1);
        });

        test('loadPacksKit requires BOTH fsPort and root', async () => {
                const seams = makeSeams();
                // loadPacksKit is ASYNC - its TypeError surfaces as a rejected
                // promise; assert.rejects is the correct channel (the DH-06 precedent).
                await assert.rejects(loadPacksKit({ clock: seams.clock, rng: seams.rng } as never), /loadPacksKit: options\.fsPort and options\.root are both required/);
        });

        test('a fresh root (no files) reopens as an empty kit', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const outcome = await loadPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(outcome.ok);
                const listed = await outcome.kit.listPacks();
                assert.ok(listed.ok);
                assert.deepStrictEqual(listed.records, []);
        });

        test('the kit re-carries the seven contract versions (the single-version pins)', () => {
                assert.equal(PACKS_CONTRACTS_VERSION, PACKS_CONTRACTS_VERSION);
                assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, DOMAIN_HARNESS_CONTRACTS_VERSION);
                assert.equal(ONBOARDING_CONTRACTS_VERSION, ONBOARDING_CONTRACTS_VERSION);
                assert.equal(ROLES_CONTRACTS_VERSION, ROLES_CONTRACTS_VERSION);
                assert.equal(ONTOLOGY_CONTRACTS_VERSION, ONTOLOGY_CONTRACTS_VERSION);
                assert.equal(TEMPLATES_CONTRACTS_VERSION, TEMPLATES_CONTRACTS_VERSION);
                assert.equal(BODIES_CONTRACTS_VERSION, BODIES_CONTRACTS_VERSION);
        });

        test('PACKS_KIT_REFUSAL_REASONS is the contract list plus the frozen extras', () => {
                const all = Array.from(PACKS_KIT_REFUSAL_REASONS);
                assert.deepStrictEqual(all.slice(0, PACKS_REJECTION_REASONS.length), Array.from(PACKS_REJECTION_REASONS));
                assert.deepStrictEqual(all.slice(PACKS_REJECTION_REASONS.length), [
                        'unknown-record',
                        'version-mismatch',
                        'empty-packs',
                        'dangling-body-ref',
                        'malformed-bodies',
                        'premature-op',
                        'stale-stage',
                        'unknown-pack',
                        'DISPOSED',
                        'CORRUPT_SEAM',
                        'E_LEDGER_TORN',
                        'E_ENVELOPE_MISMATCH',
                        'PACKS_IO',
                        'UNKNOWN_FILTER',
                ]);
        });
});

suite('packsKit · beginPacks', () => {
        test('green: mints flauz:pak:<16-hex>, composing, ZERO packs, the begin note', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const outcome = await kit.beginPacks(HARNESS_ID, 'software');
                assert.ok(outcome.ok);
                assert.match(outcome.record.id, /^flauz:pak:[0-9a-f]{16}$/);
                assert.equal(outcome.record.harnessId, HARNESS_ID);
                assert.equal(outcome.record.industry, 'software');
                assert.equal(outcome.record.stage, 'composing');
                assert.deepStrictEqual(outcome.record.packs, []);
                assert.equal(outcome.record.history.length, 1);
                assert.equal(outcome.record.history[0].fromStage, null);
                assert.equal(outcome.record.history[0].toStage, 'composing');
                assert.equal(outcome.record.history[0].op, 'begin-packs');
        });

        test('bad-harness-id refuses (the REAL DH-01 alphabet)', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                for (const harnessId of ['flauz:pak:0123456789abcdef', 'flauz:hrn:0123456789ABCDEF', 7]) {
                        const refusal = refusalOf(await kit.beginPacks(harnessId, 'software'));
                        assert.equal(refusal.reason, 'bad-harness-id');
                }
        });

        test('bad-industry refuses', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const refusal = refusalOf(await kit.beginPacks(HARNESS_ID, 'aerospace'));
                assert.equal(refusal.reason, 'bad-industry');
                assert.equal(refusal.law, 'THE FROZEN-VOCABULARY LAW');
        });

        test('CORRUPT_SEAM: a non-16-hex rng read or a duplicate minted id', async () => {
                const bad = createPacksKit({ clock: () => '2026-01-01T00:00:00.000Z', rng: () => '0123456789abcdef' });
                const first = await bad.beginPacks(HARNESS_ID, 'software');
                assert.ok(first.ok);
                const second = refusalOf(await bad.beginPacks(HARNESS_ID, 'software'));
                assert.equal(second.reason, 'CORRUPT_SEAM');
                let call = 0;
                const flip = createPacksKit({ clock: () => '2026-01-01T00:00:00.000Z', rng: () => (call++ === 0 ? '0123456789abcdef' : 'zzz') });
                const refusal = refusalOf(await flip.beginPacks(HARNESS_ID, 'software'));
                assert.equal(refusal.reason, 'CORRUPT_SEAM');
        });
});

suite('packsKit · addPack', () => {
        test('green: the pack lands with the add-pack self-edge note', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                const outcome = await kit.addPack(packsId, { packKey: 'core', summary: 'The core pack.', bodyRefs: ['triage'] });
                assert.ok(outcome.ok);
                assert.equal(outcome.record.packs.length, 1);
                assert.deepStrictEqual(outcome.record.packs[0], { packKey: 'core', summary: 'The core pack.', bodyRefs: ['triage'] });
                const note = outcome.record.history[outcome.record.history.length - 1];
                assert.equal(note.op, 'add-pack');
                assert.equal(note.fromStage, 'composing');
                assert.equal(note.toStage, 'composing');
        });

        test('the honest-gap law: empty bodyRefs land', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                const outcome = await kit.addPack(packsId, { packKey: 'core', summary: 'The core pack.', bodyRefs: [] });
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.record.packs[0].bodyRefs, []);
        });

        test('THE TWO-PHASE LAW: a dangling bodyRef is LEGAL while composing', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                const outcome = await kit.addPack(packsId, { packKey: 'core', summary: 'The core pack.', bodyRefs: ['ghost-body'] });
                assert.ok(outcome.ok);
        });

        test('a payload refusal carries the COMPLETE rejection table and leaves the record unchanged', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: ['triage'] });
                const before = await kit.inspectPacks(packsId);
                const refusal = refusalOf(await kit.addPack(packsId, { packKey: ' x ', summary: '', bodyRefs: 'nope', tools: 1 }));
                assert.equal(refusal.reason, 'no-fork');
                assert.ok(refusal.rejections !== undefined);
                assert.deepStrictEqual(refusal.rejections.map((rejection) => rejection.reason), ['no-fork', 'pack-key-whitespace', 'summary-length', 'bad-body-refs-carrier']);
                const after = await kit.inspectPacks(packsId);
                assert.deepStrictEqual(after, before);
        });

        test('duplicate-pack-key refuses and leaves the record unchanged', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: [] });
                const before = await kit.inspectPacks(packsId);
                const refusal = refusalOf(await kit.addPack(packsId, { packKey: 'core', summary: 'Again.', bodyRefs: [] }));
                assert.equal(refusal.reason, 'duplicate-pack-key');
                assert.deepStrictEqual(refusal.items, ['core']);
                assert.deepStrictEqual(await kit.inspectPacks(packsId), before);
        });

        test('exactly 64 packs compose; the 65th refuses max-packs', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                for (let index = 0; index < 64; index += 1) {
                        await addPackGreen(kit, packsId, { packKey: `p${String(index).padStart(2, '0')}`, summary: 'A default pack.', bodyRefs: [] });
                }
                const atBound = await kit.inspectPacks(packsId);
                assert.ok(atBound.ok);
                assert.equal(atBound.record.packs.length, 64);
                const refusal = refusalOf(await kit.addPack(packsId, { packKey: 'p64', summary: 'One too many.', bodyRefs: [] }));
                assert.equal(refusal.reason, 'max-packs');
        });

        test('unknown-record (malformed or unresolved id) and stale-stage refuse', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(refusalOf(await kit.addPack('nope', { packKey: 'k', summary: 's', bodyRefs: [] })).reason, 'unknown-record');
                assert.equal(refusalOf(await kit.addPack('flauz:pak:ffffffffffffffff', { packKey: 'k', summary: 's', bodyRefs: [] })).reason, 'unknown-record');
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: [] });
                const finalized = await kit.finalizePacks(packsId, composedBodies());
                assert.ok(finalized.ok);
                assert.equal(refusalOf(await kit.addPack(packsId, { packKey: 'later', summary: 'Too late.', bodyRefs: [] })).reason, 'stale-stage');
        });
});

suite('packsKit · replacePackSummary', () => {
        test('green: ONLY the summary changes (the packKey and bodyRefs are immutable)', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: ['triage', 'report'] });
                const outcome = await kit.replacePackSummary(packsId, 'core', 'The standing core capability pack.');
                assert.ok(outcome.ok);
                assert.equal(outcome.record.packs[0].packKey, 'core');
                assert.deepStrictEqual(outcome.record.packs[0].bodyRefs, ['triage', 'report']);
                assert.equal(outcome.record.packs[0].summary, 'The standing core capability pack.');
        });

        test('unknown-pack refuses (missing or malformed packKey)', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                assert.equal(refusalOf(await kit.replacePackSummary(packsId, 'ghost', 's')).reason, 'unknown-pack');
                assert.equal(refusalOf(await kit.replacePackSummary(packsId, 7, 's')).reason, 'unknown-pack');
        });

        test('an invalid summary carries the COMPLETE table and leaves the record unchanged', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: [] });
                const before = await kit.inspectPacks(packsId);
                const refusal = refusalOf(await kit.replacePackSummary(packsId, 'core', ''));
                assert.equal(refusal.reason, 'summary-length');
                assert.ok(refusal.rejections !== undefined);
                assert.deepStrictEqual(refusal.rejections.map((rejection) => rejection.reason), ['summary-length']);
                assert.deepStrictEqual(await kit.inspectPacks(packsId), before);
        });

        test('stale-stage refuses on a composed record', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: [] });
                assert.ok((await kit.finalizePacks(packsId, composedBodies())).ok);
                assert.equal(refusalOf(await kit.replacePackSummary(packsId, 'core', 'Late.')).reason, 'stale-stage');
        });
});

suite('packsKit · removePack', () => {
        test('green: the pack leaves with the remove note', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: [] });
                await addPackGreen(kit, packsId, { packKey: 'extra', summary: 'Extra.', bodyRefs: [] });
                const outcome = await kit.removePack(packsId, 'core');
                assert.ok(outcome.ok);
                assert.equal(outcome.record.packs.length, 1);
                assert.equal(outcome.record.packs[0].packKey, 'extra');
                assert.equal(outcome.record.history[outcome.record.history.length - 1].op, 'remove-pack');
        });

        test('removing the LAST pack is LEGAL while composing; the floor never dips below zero', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: [] });
                const outcome = await kit.removePack(packsId, 'core');
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.record.packs, []);
                // an empty record's remove is unknown-pack (the floor never dips below zero)
                assert.equal(refusalOf(await kit.removePack(packsId, 'core')).reason, 'unknown-pack');
        });

        test('unknown-pack refuses', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                assert.equal(refusalOf(await kit.removePack(packsId, 'ghost')).reason, 'unknown-pack');
        });

        test('THE REMOVE+RE-ADD LAW: a changed packKey is a NEW pack (remove, then re-add)', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: [] });
                assert.ok((await kit.removePack(packsId, 'core')).ok);
                const outcome = await kit.addPack(packsId, { packKey: 'deep-core', summary: 'A different pack.', bodyRefs: [] });
                assert.ok(outcome.ok);
                assert.equal(outcome.record.packs[0].packKey, 'deep-core');
        });
});

suite('packsKit · finalizePacks', () => {
        test('the empty-packs floor refuses empty-packs', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                const refusal = refusalOf(await kit.finalizePacks(packsId, composedBodies()));
                assert.equal(refusal.reason, 'empty-packs');
                assert.deepStrictEqual(refusal.items, ['packs']);
        });

        test('malformed-bodies refuses: a non-record or a record failing the REAL DH-06 walk', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: ['triage'] });
                assert.equal(refusalOf(await kit.finalizePacks(packsId, null)).reason, 'malformed-bodies');
                assert.equal(refusalOf(await kit.finalizePacks(packsId, { nope: 1 })).reason, 'malformed-bodies');
                const broken = composedBodies() as Record<string, unknown>;
                broken.industry = 'aerospace';
                assert.equal(refusalOf(await kit.finalizePacks(packsId, broken)).reason, 'malformed-bodies');
        });

        test('malformed-bodies refuses: a composing (non-composed) bodies record', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: [] });
                const composing = composedBodies() as Record<string, unknown>;
                composing.stage = 'composing';
                const refusal = refusalOf(await kit.finalizePacks(packsId, composing));
                assert.equal(refusal.reason, 'malformed-bodies');
                assert.equal(refusal.law, 'THE BODY-RESOLUTION LAW');
        });

        test('THE NO-DANGLING-REF boundary refuses typed, naming every offending ref once, first-seen order', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: ['triage', 'ghost'] });
                await addPackGreen(kit, packsId, { packKey: 'extra', summary: 'Extra.', bodyRefs: ['phantom', 'report', 'ghost'] });
                const refusal = refusalOf(await kit.finalizePacks(packsId, composedBodies()));
                assert.equal(refusal.reason, 'dangling-body-ref');
                assert.equal(refusal.law, 'THE BODY-RESOLUTION LAW');
                assert.deepStrictEqual(refusal.items, ['ghost', 'phantom']);
        });

        test('the refusal leaves the record unchanged (still composing)', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: ['ghost'] });
                const before = await kit.inspectPacks(packsId);
                refusalOf(await kit.finalizePacks(packsId, composedBodies()));
                assert.deepStrictEqual(await kit.inspectPacks(packsId), before);
        });

        test('green: composing -> composed, TERMINAL, packs carried, the finalize note', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: ['triage'] });
                const outcome = await kit.finalizePacks(packsId, composedBodies());
                assert.ok(outcome.ok);
                assert.equal(outcome.record.stage, 'composed');
                assert.equal(outcome.record.packs.length, 1);
                const note = outcome.record.history[outcome.record.history.length - 1];
                assert.equal(note.op, 'finalize-packs');
                assert.equal(note.fromStage, 'composing');
                assert.equal(note.toStage, 'composed');
                assert.equal(note.law, 'THE BODY-RESOLUTION LAW');
        });

        test('after compose: every mutating op refuses stale-stage', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: [] });
                assert.ok((await kit.finalizePacks(packsId, composedBodies())).ok);
                assert.equal(refusalOf(await kit.addPack(packsId, { packKey: 'late', summary: 'Late.', bodyRefs: [] })).reason, 'stale-stage');
                assert.equal(refusalOf(await kit.replacePackSummary(packsId, 'core', 'Late.')).reason, 'stale-stage');
                assert.equal(refusalOf(await kit.removePack(packsId, 'core')).reason, 'stale-stage');
                assert.equal(refusalOf(await kit.finalizePacks(packsId, composedBodies())).reason, 'stale-stage');
        });

        test('the honest-gap law: a pack with zero bodyRefs finalizes green', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'org-wide', summary: 'A pack that names zero bodies.', bodyRefs: [] });
                const outcome = await kit.finalizePacks(packsId, composedBodies());
                assert.ok(outcome.ok);
                assert.equal(outcome.record.stage, 'composed');
                assert.deepStrictEqual(outcome.record.packs[0].bodyRefs, []);
        });

        test('the frozen-record semantics: two finalize runs over identical seams serialize byte-equal', async () => {
                const run = async (): Promise<string> => {
                        const seams = makeSeams();
                        const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                        const packsId = await beginGreen(kit);
                        await addPackGreen(kit, packsId, { packKey: 'core', summary: 'The core pack.', bodyRefs: ['triage'] });
                        const finalized = await kit.finalizePacks(packsId, composedBodies());
                        if (!finalized.ok) {
                                throw new Error(`finalizePacks refused: ${finalized.refusal.reason}`);
                        }
                        return serializeCapabilityPacksRecord(finalized.record);
                };
                assert.equal(await run(), await run());
        });
});

suite('packsKit · emitCapabilityRef', () => {
        test('premature-op on a composing record', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                const refusal = refusalOf(await kit.emitCapabilityRef(packsId));
                assert.equal(refusal.reason, 'premature-op');
                assert.equal(refusal.law, 'THE FORWARD-ONLY LAW');
        });

        test('green on a composed record: the capabilityRef is the record id', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: [] });
                assert.ok((await kit.finalizePacks(packsId, composedBodies())).ok);
                const outcome = await kit.emitCapabilityRef(packsId);
                assert.ok(outcome.ok);
                assert.equal(outcome.capabilityRef, packsId);
                assert.match(outcome.capabilityRef, /^flauz:pak:[0-9a-f]{16}$/);
        });

        test('unknown-record refuses', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(refusalOf(await kit.emitCapabilityRef('flauz:pak:ffffffffffffffff')).reason, 'unknown-record');
        });
});

suite('packsKit · THE CROSS-KIT INTEGRATION PINS (the wave crown)', () => {
        test('the crown: real harness kit -> real roles kit -> real bodies kit -> capability packs -> finalize -> emit -> the REAL review-composition validator passes', async () => {
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
                const finalizedBodies = await bodiesKit.finalizeDefaults(defaultsId, finalizedRoles.session);
                assert.ok(finalizedBodies.ok);
                assert.equal(finalizedBodies.record.stage, 'composed');
                const packsKit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const begunPacks = await packsKit.beginPacks(harnessId, 'software');
                assert.ok(begunPacks.ok);
                const packsId = begunPacks.record.id;
                const realBodyKeys = finalizedBodies.record.bodies.map((body) => body.bodyKey);
                assert.ok((await packsKit.addPack(packsId, { packKey: 'core', summary: 'The standing core capability pack.', bodyRefs: realBodyKeys })).ok);
                const finalized = await packsKit.finalizePacks(packsId, finalizedBodies.record);
                assert.ok(finalized.ok);
                assert.equal(finalized.record.stage, 'composed');
                const emitted = await packsKit.emitCapabilityRef(packsId);
                assert.ok(emitted.ok);
                assert.equal(emitted.capabilityRef, packsId);
                // The emitted capabilityRef rides the REAL review composition's
                // capabilityRefs family (the landed DH-02 schema's capability-side
                // slot for the domain's default capability packs).
                const composition = validateOnboardingReviewComposition({
                        roles: finalizedRoles.session.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
                        capabilityRefs: [emitted.capabilityRef],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [],
                });
                assert.ok(composition.ok);
                assert.deepStrictEqual(composition.value.capabilityRefs, [emitted.capabilityRef]);
        });

        test('the crown boundary: a dangling bodyRef refuses against the REAL composed bodies record', async () => {
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
                assert.ok((await bodiesKit.addBody(begunDefaults.record.bodyId, { bodyKey: 'triage', summary: 'Triage the ghost.', roleRefs: ['analyst'] })).ok);
                const finalizedBodies = await bodiesKit.finalizeDefaults(begunDefaults.record.bodyId, finalizedRoles.session);
                assert.ok(finalizedBodies.ok);
                const packsKit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const begunPacks = await packsKit.beginPacks(minted.record.harnessId, 'software');
                assert.ok(begunPacks.ok);
                assert.ok((await packsKit.addPack(begunPacks.record.id, { packKey: 'core', summary: 'The core pack.', bodyRefs: ['triage', 'ghost'] })).ok);
                const refusal = refusalOf(await packsKit.finalizePacks(begunPacks.record.id, finalizedBodies.record));
                assert.equal(refusal.reason, 'dangling-body-ref');
                assert.deepStrictEqual(refusal.items, ['ghost']);
        });

        test('the crown family form: the emitted ref rides capabilityRefs; a duplicate or non-string member refuses the REAL validator', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: [] });
                assert.ok((await kit.finalizePacks(packsId, composedBodies())).ok);
                const emitted = await kit.emitCapabilityRef(packsId);
                assert.ok(emitted.ok);
                const green = validateOnboardingReviewComposition({
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [emitted.capabilityRef],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [],
                });
                assert.ok(green.ok);
                const duplicated = validateOnboardingReviewComposition({
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [emitted.capabilityRef, emitted.capabilityRef],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [],
                });
                assert.ok(!duplicated.ok);
                assert.equal(duplicated.refusal.reason, 'duplicate-ref');
                const malformed = validateOnboardingReviewComposition({
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [emitted.capabilityRef, 7],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [],
                });
                assert.ok(!malformed.ok);
                assert.equal(malformed.refusal.reason, 'malformed-refs');
        });

        test('the crown honest gap: a pack with zero bodyRefs finalizes green against the real composed bodies record', async () => {
                const seams = makeSeams();
                const rolesKit = createRolesKit({ clock: seams.clock, rng: seams.rng });
                const session = await rolesKit.beginSession('software');
                assert.ok(session.ok);
                assert.ok((await rolesKit.addRole(session.session.sessionId, { roleKey: 'analyst', summary: 'Runs the domain analysis.' })).ok);
                const finalizedRoles = await rolesKit.finalizeComposition(session.session.sessionId);
                assert.ok(finalizedRoles.ok);
                const bodiesKit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
                const begunDefaults = await bodiesKit.beginDefaults(HARNESS_ID, 'software');
                assert.ok(begunDefaults.ok);
                assert.ok((await bodiesKit.addBody(begunDefaults.record.bodyId, { bodyKey: 'triage', summary: 'Triage the work.', roleRefs: ['analyst'] })).ok);
                const finalizedBodies = await bodiesKit.finalizeDefaults(begunDefaults.record.bodyId, finalizedRoles.session);
                assert.ok(finalizedBodies.ok);
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'org-wide', summary: 'A pack that names zero bodies.', bodyRefs: [] });
                const finalized = await kit.finalizePacks(packsId, finalizedBodies.record);
                assert.ok(finalized.ok);
                assert.equal(finalized.record.stage, 'composed');
        });
});

suite('packsKit · persistence (the PIN-2 mirror)', () => {
        test('the ledger and the envelope land lazily at the distinct family paths', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.equal(port.dump('ws/.flauz/harness/packs-ops.jsonl'), undefined);
                const packsId = await beginGreen(kit);
                const ledger = port.dump(`ws/${PACKS_LEDGER_RELATIVE_PATH}`);
                assert.ok(ledger !== undefined && ledger.endsWith('\n'));
                assert.equal(ledger.split('\n').length - 1, 1);
                // the canonical line discipline: the frozen eleven-key schema, the seq equal
                // to the line number, the contract version on every line.
                const line = JSON.parse((ledger as string).split('\n')[0]) as Record<string, unknown>;
                assert.deepStrictEqual(Object.keys(line).sort(), [...PACKS_LEDGER_LINE_SCHEMA_KEYS].sort());
                assert.equal(line.seq, 1);
                assert.equal(line.contractVersion, PACKS_CONTRACTS_VERSION);
                assert.equal(line.packsId, packsId);
                const envelope = port.dump(`ws/${PACKS_ENVELOPE_RELATIVE_PATH}`);
                assert.ok(envelope !== undefined);
                const parsed = JSON.parse(envelope as string) as { contractVersion: string; seq: number; records: unknown[] };
                assert.equal(parsed.contractVersion, PACKS_CONTRACTS_VERSION);
                assert.equal(parsed.seq, 1);
                assert.equal(parsed.records.length, 1);
        });

        test('restart replay is byte-identical and the seq continues', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const first = await beginGreen(kit);
                await addPackGreen(kit, first, { packKey: 'core', summary: 'Core.', bodyRefs: ['triage'] });
                const second = await beginGreen(kit);
                const beforeFirst = await kit.inspectPacks(first);
                assert.ok(beforeFirst.ok);
                const reloaded = await loadPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                const afterFirst = await reloaded.kit.inspectPacks(first);
                assert.ok(afterFirst.ok);
                assert.deepStrictEqual(afterFirst, beforeFirst);
                assert.equal(serializeCapabilityPacksRecord(afterFirst.record), serializeCapabilityPacksRecord(beforeFirst.record));
                assert.ok((await reloaded.kit.addPack(second, { packKey: 'extra', summary: 'Extra.', bodyRefs: [] })).ok);
                const ledger = port.dump(`ws/${PACKS_LEDGER_RELATIVE_PATH}`) as string;
                assert.equal(ledger.split('\n').length - 1, 4);
                // the seq equals the line number on every line (the append-only ledger law).
                const ledgerLines = ledger.split('\n');
                ledgerLines.pop();
                for (let i = 0; i < ledgerLines.length; i += 1) {
                        const parsedLine = JSON.parse(ledgerLines[i]) as { seq: number };
                        assert.equal(parsedLine.seq, i + 1);
                }
                const envelope = JSON.parse(port.dump(`ws/${PACKS_ENVELOPE_RELATIVE_PATH}`) as string) as { seq: number };
                assert.equal(envelope.seq, 4);
        });

        test('a torn ledger (no trailing newline) is E_LEDGER_TORN', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                const ledgerPath = `ws/${PACKS_LEDGER_RELATIVE_PATH}`;
                port.overwrite(ledgerPath, (port.dump(ledgerPath) as string).slice(0, -1));
                const outcome = await loadPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_LEDGER_TORN');
        });

        test('a content-divergent envelope is E_ENVELOPE_MISMATCH (never silently rebuilt)', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: [] });
                const envelopePath = `ws/${PACKS_ENVELOPE_RELATIVE_PATH}`;
                const parsed = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: Record<string, unknown>[] };
                parsed.records[0].packs = [];
                port.overwrite(envelopePath, JSON.stringify(parsed));
                const outcome = await loadPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
        });

        test('a missing envelope while the ledger carries lines is E_ENVELOPE_MISMATCH', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                port.remove(`ws/${PACKS_ENVELOPE_RELATIVE_PATH}`);
                const outcome = await loadPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
        });

        test('an envelope seq ahead is E_LEDGER_TORN; behind is E_ENVELOPE_MISMATCH', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                await beginGreen(kit);
                const envelopePath = `ws/${PACKS_ENVELOPE_RELATIVE_PATH}`;
                const ahead = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: unknown[] };
                ahead.seq = 3;
                port.overwrite(envelopePath, JSON.stringify(ahead));
                const aheadOutcome = await loadPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!aheadOutcome.ok);
                assert.equal(aheadOutcome.refusal.reason, 'E_LEDGER_TORN');
                const behind = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: unknown[] };
                behind.seq = 1;
                port.overwrite(envelopePath, JSON.stringify(behind));
                const behindOutcome = await loadPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!behindOutcome.ok);
                assert.equal(behindOutcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
        });

        test('the multi-record ledger replays both records in id order', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const first = await beginGreen(kit);
                const second = await beginGreen(kit);
                await addPackGreen(kit, first, { packKey: 'core', summary: 'Core.', bodyRefs: [] });
                assert.ok((await kit.finalizePacks(first, composedBodies())).ok);
                const reloaded = await loadPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                const listed = await reloaded.kit.listPacks();
                assert.ok(listed.ok);
                assert.equal(listed.records.length, 2);
                assert.deepStrictEqual(listed.records.map((record) => record.id), [first, second].sort());
                const composed = await reloaded.kit.inspectPacks(first);
                assert.ok(composed.ok);
                assert.equal(composed.record.stage, 'composed');
        });

        test('a fresh kit never appends over a non-empty ledger (E_LEDGER_TORN)', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                const ledgerPath = `ws/${PACKS_LEDGER_RELATIVE_PATH}`;
                const lineCount = (port.dump(ledgerPath) as string).split('\n').length - 1;
                const fresh = createPacksKit({ clock: seams.clock, rng: makeSeams().rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const refusal = refusalOf(await fresh.beginPacks(HARNESS_ID, 'software'));
                assert.equal(refusal.reason, 'E_LEDGER_TORN');
                assert.equal((port.dump(ledgerPath) as string).split('\n').length - 1, lineCount);
        });

        test('a tampered contractVersion is the typed version-mismatch', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                const ledgerPath = `ws/${PACKS_LEDGER_RELATIVE_PATH}`;
                const lines = (port.dump(ledgerPath) as string).split('\n');
                const first = JSON.parse(lines[0]) as Record<string, unknown>;
                first.contractVersion = '9.9.9';
                lines[0] = JSON.stringify(first);
                port.overwrite(ledgerPath, `${lines.join('\n')}\n`);
                const outcome = await loadPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'version-mismatch');
        });

        test('a tampered finalize payload (a dangling resolution) is E_LEDGER_TORN - the replay re-proves THE BODY-RESOLUTION LAW', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: ['triage'] });
                assert.ok((await kit.finalizePacks(packsId, composedBodies())).ok);
                const ledgerPath = `ws/${PACKS_LEDGER_RELATIVE_PATH}`;
                const lines = (port.dump(ledgerPath) as string).split('\n');
                const last = JSON.parse(lines[lines.length - 2]) as { payload: { bodies: { bodyKey: string }[] } };
                last.payload.bodies[0].bodyKey = 'ghost';
                lines[lines.length - 2] = JSON.stringify(last);
                port.overwrite(ledgerPath, `${lines.join('\n')}\n`);
                const outcome = await loadPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_LEDGER_TORN');
        });

        test('the finalize line carries the caller-supplied composed bodies record AS IT STOOD', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const packsId = await beginGreen(kit);
                await addPackGreen(kit, packsId, { packKey: 'core', summary: 'Core.', bodyRefs: ['triage'] });
                assert.ok((await kit.finalizePacks(packsId, composedBodies())).ok);
                const lines = (port.dump(`ws/${PACKS_LEDGER_RELATIVE_PATH}`) as string).split('\n');
                const last = JSON.parse(lines[lines.length - 2]) as { op: string; payload: { bodyId: string; stage: string; bodies: unknown[] } };
                assert.equal(last.op, 'finalize-packs');
                assert.equal(last.payload.bodyId, 'flauz:bod:0123456789abcdef');
                assert.equal(last.payload.stage, 'composed');
                assert.equal(last.payload.bodies.length, 2);
        });
});

suite('packsKit · dispose and determinism', () => {
        test('THE DISPOSE LAW: every operation after dispose rejects', async () => {
                const seams = makeSeams();
                const kit = createPacksKit({ clock: seams.clock, rng: seams.rng });
                const packsId = await beginGreen(kit);
                kit.dispose();
                assert.equal(refusalOf(await kit.beginPacks(HARNESS_ID, 'software')).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.addPack(packsId, { packKey: 'k', summary: 's', bodyRefs: [] })).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.replacePackSummary(packsId, 'k', 's')).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.removePack(packsId, 'k')).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.finalizePacks(packsId, composedBodies())).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.emitCapabilityRef(packsId)).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.inspectPacks(packsId)).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.listPacks()).reason, 'DISPOSED');
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
