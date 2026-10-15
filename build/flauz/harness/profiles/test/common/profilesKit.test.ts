/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-008 profiles kit battery: the fail-closed factories, the staged
 * op surface (begin/add/replace/remove/finalize/emitPolicyRef/
 * emitEvidenceRef) with every refusal class and the record-unchanged
 * law, THE AUTHORITY-BINDING refusals through the kit (the REAL
 * catalog permission predicate, the REAL risk tiers, the REAL
 * evidence ladder, the REAL eval dimensions), THE CROSS-KIT
 * INTEGRATION PINS (the wave crown: the REAL DH-01 harness kit ->
 * this kit -> the REAL DH-02 review-composition validator riding the
 * policyRefs / evidenceRefs families), the PIN-2 persistence family
 * (ledger + envelope, torn line, divergent envelope, restart replay,
 * the multi-record ledger, the fresh-kit guard, version drift, the
 * tampered payload with the vocabulary re-proved from the ledger
 * alone), the frozen-record determinism, the dispose law, and the
 * in-suite determinism greps.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHarnessKit } from '../../../contract/common/domainHarnessKit.js';
import { validateOnboardingReviewComposition } from '../../../onboarding/common/onboardingContract.js';
import {
        CATALOG_PERMISSION_IDS as REAL_CATALOG_PERMISSION_IDS,
        CATALOG_PERMISSION_RISK_TIERS as REAL_CATALOG_PERMISSION_RISK_TIERS,
        isCatalogPermissionId as REAL_isCatalogPermissionId,
        isCatalogPermissionRiskTier as REAL_isCatalogPermissionRiskTier,
} from '../../../../capabilities/packs/common/catalog.js';
import {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        ONBOARDING_CONTRACTS_VERSION,
        ONTOLOGY_CONTRACTS_VERSION,
        ROLES_CONTRACTS_VERSION,
        TEMPLATES_CONTRACTS_VERSION,
        BODIES_CONTRACTS_VERSION,
        PACKS_CONTRACTS_VERSION,
        PROFILES_CONTRACTS_VERSION,
        PROFILES_ENVELOPE_RELATIVE_PATH,
        PROFILES_EVIDENCE_LADDER,
        PROFILES_EVAL_DIMENSIONS,
        PROFILES_KIT_REFUSAL_REASONS,
        PROFILES_LEDGER_LINE_SCHEMA_KEYS,
        PROFILES_LEDGER_RELATIVE_PATH,
        createProfilesKit,
        loadProfilesKit,
} from '../../common/profilesKit.js';
import { PROFILES_REJECTION_REASONS, serializeProfilesRecord } from '../../common/profilesContract.js';
import type { HarnessFsPort, ProfilesKit, ProfilesKitRefusal } from '../../common/profilesKit.js';

const KIT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/profilesKit.ts', import.meta.url)), 'utf8');

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
        protected readonly files = new Map<string, string>();
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

/** An fs port that refuses appends (the PROFILES_IO refusal surface). */
class RefusingAppendFsPort extends MemoryFsPort {
        async appendFile(_path: string, _text: string): Promise<void> {
                throw new Error('the append was refused');
        }
}

/** An fs port that refuses the mkdir (the PROFILES_IO refusal surface at load). */
class RefusingMkdirFsPort extends MemoryFsPort {
        async mkdir(_path: string, _options: { recursive: boolean }): Promise<void> {
                throw new Error('the mkdir was refused');
        }
}

function greenProfile(): Record<string, unknown> {
        return {
                profileKey: 'core',
                summary: 'The core policy profile.',
                permissionRefs: ['read-files', 'network-access'],
                approvalTiers: ['high'],
                evidenceFloor: 'local-real',
                kpiDimensions: ['success', 'cost'],
        };
}

async function beginGreen(kit: ProfilesKit, harnessId: string = HARNESS_ID): Promise<string> {
        const outcome = await kit.beginProfiles(harnessId);
        if (!outcome.ok) {
                throw new Error(`beginProfiles refused: ${outcome.refusal.reason}`);
        }
        assert.equal(outcome.record.stage, 'composing');
        return outcome.record.profilesId;
}

async function addProfileGreen(kit: ProfilesKit, profilesId: string, profile: Record<string, unknown>): Promise<void> {
        const outcome = await kit.addProfile(profilesId, profile);
        if (!outcome.ok) {
                throw new Error(`addProfile refused: ${outcome.refusal.reason}`);
        }
}

function refusalOf(outcome: { ok: boolean; refusal?: ProfilesKitRefusal }): ProfilesKitRefusal {
        if (outcome.ok || outcome.refusal === undefined) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.refusal;
}

suite('profilesKit · factories', () => {
        test('createProfilesKit binds the injected seams (green, no persistence)', () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(typeof kit.disposeProfiles, 'function');
                assert.equal(typeof kit.beginProfiles, 'function');
                assert.equal(typeof kit.emitPolicyRef, 'function');
                assert.equal(typeof kit.emitEvidenceRef, 'function');
                assert.equal(typeof kit.listProfilesSessions, 'function');
        });

        test('factory misuse throws TypeError: the options shape and the seam reads', () => {
                const seams = makeSeams();
                assert.throws(() => createProfilesKit(null as never), /createProfilesKit: options must be an object/);
                assert.throws(() => createProfilesKit({ rng: seams.rng } as never), /options\.clock must be a function/);
                assert.throws(() => createProfilesKit({ clock: seams.clock } as never), /options\.rng must be a function/);
                assert.throws(() => createProfilesKit({ clock: () => '', rng: seams.rng } as never), /options\.clock\(\) must return a non-empty ISO string/);
                assert.throws(() => createProfilesKit({ clock: seams.clock, rng: () => 'nope' } as never), /options\.rng\(\) must return exactly 16 lowercase hex chars/);
        });

        test('factory misuse throws TypeError: the fsPort / root pairing', () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                assert.throws(() => createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort } as never), /come together or not at all/);
                assert.throws(() => createProfilesKit({ clock: seams.clock, rng: seams.rng, root: 'ws' } as never), /come together or not at all/);
                assert.throws(() => createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: {} as HarnessFsPort, root: 'ws' } as never), /options\.fsPort\.readFile must be a function/);
                assert.throws(() => createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: '' } as never), /options\.root must be a non-empty string/);
        });

        test('the factory consumes exactly ONE clock read and ONE rng read', () => {
                const seams = makeSeams();
                createProfilesKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(seams.clockReads(), 1);
                assert.equal(seams.rngReads(), 1);
        });

        test('loadProfilesKit requires BOTH fsPort and root', async () => {
                const seams = makeSeams();
                // loadProfilesKit is ASYNC - its TypeError surfaces as a rejected
                // promise; assert.rejects is the correct channel (the DH-06 precedent).
                await assert.rejects(loadProfilesKit({ clock: seams.clock, rng: seams.rng } as never), /loadProfilesKit: options\.fsPort and options\.root are both required/);
        });

        test('a fresh root (no files) reopens as an empty kit', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const outcome = await loadProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(outcome.ok);
                const listed = await outcome.kit.listProfilesSessions();
                assert.ok(listed.ok);
                assert.deepStrictEqual(listed.records, []);
        });

        test('the kit re-carries the eight family versions by reference (the single-version pins)', async () => {
                const kitModule = await import('../../common/profilesKit.js');
                const contractModule = await import('../../common/profilesContract.js');
                const dh01 = await import('../../../contract/common/domainHarnessContract.js');
                const dh02 = await import('../../../onboarding/common/onboardingContract.js');
                const dh03 = await import('../../../roles/common/rolesContract.js');
                const dh04 = await import('../../../ontology/common/ontologyContract.js');
                const dh05 = await import('../../../templates/common/templatesContract.js');
                const dh06 = await import('../../../bodies/common/bodiesContract.js');
                const dh07 = await import('../../../packs/common/packsContract.js');
                assert.equal(kitModule.PROFILES_CONTRACTS_VERSION, contractModule.PROFILES_CONTRACTS_VERSION);
                assert.equal(kitModule.DOMAIN_HARNESS_CONTRACTS_VERSION, dh01.DOMAIN_HARNESS_CONTRACTS_VERSION);
                assert.equal(kitModule.ONBOARDING_CONTRACTS_VERSION, dh02.ONBOARDING_CONTRACTS_VERSION);
                assert.equal(kitModule.ROLES_CONTRACTS_VERSION, dh03.ROLES_CONTRACTS_VERSION);
                assert.equal(kitModule.ONTOLOGY_CONTRACTS_VERSION, dh04.ONTOLOGY_CONTRACTS_VERSION);
                assert.equal(kitModule.TEMPLATES_CONTRACTS_VERSION, dh05.TEMPLATES_CONTRACTS_VERSION);
                assert.equal(kitModule.BODIES_CONTRACTS_VERSION, dh06.BODIES_CONTRACTS_VERSION);
                assert.equal(kitModule.PACKS_CONTRACTS_VERSION, dh07.PACKS_CONTRACTS_VERSION);
        });

        test('the kit re-exports the REAL authority vocabularies by reference (no injection, no transcription)', async () => {
                const kitModule = await import('../../common/profilesKit.js');
                assert.equal(kitModule.CATALOG_PERMISSION_IDS, REAL_CATALOG_PERMISSION_IDS);
                assert.equal(kitModule.CATALOG_PERMISSION_RISK_TIERS, REAL_CATALOG_PERMISSION_RISK_TIERS);
                assert.equal(kitModule.isCatalogPermissionId, REAL_isCatalogPermissionId);
                assert.equal(kitModule.isCatalogPermissionRiskTier, REAL_isCatalogPermissionRiskTier);
                assert.deepStrictEqual([...kitModule.PROFILES_EVIDENCE_LADDER], [...PROFILES_EVIDENCE_LADDER]);
                assert.deepStrictEqual([...kitModule.PROFILES_EVAL_DIMENSIONS], [...PROFILES_EVAL_DIMENSIONS]);
        });

        test('PROFILES_KIT_REFUSAL_REASONS is the contract list plus the frozen extras', () => {
                const all = Array.from(PROFILES_KIT_REFUSAL_REASONS);
                assert.deepStrictEqual(all.slice(0, PROFILES_REJECTION_REASONS.length), Array.from(PROFILES_REJECTION_REASONS));
                assert.deepStrictEqual(all.slice(PROFILES_REJECTION_REASONS.length), [
                        'unknown-record',
                        'version-mismatch',
                        'empty-profiles',
                        'premature-op',
                        'stale-stage',
                        'unknown-profile',
                        'DISPOSED',
                        'CORRUPT_SEAM',
                        'E_LEDGER_TORN',
                        'E_ENVELOPE_MISMATCH',
                        'PROFILES_IO',
                        'UNKNOWN_FILTER',
                ]);
        });

        test('THE NO-NEW-AUTHORITY LAW: the kit options carry no catalog / authority seam', () => {
                const source = KIT_SOURCE;
                assert.ok(source.includes('readonly clock: () => string;'));
                assert.ok(source.includes('readonly rng: () => string;'));
                assert.ok(!/catalog:/.test(source.replace(/ \* .*catalog.*/g, '').replace(/ \* .*(?:authority|vocabular).*/g, '')));
        });
});

suite('profilesKit · beginProfiles', () => {
        test('green: mints flauz:prf:<16-hex>, composing, ZERO profiles, the begin note', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const outcome = await kit.beginProfiles(HARNESS_ID);
                assert.ok(outcome.ok);
                assert.match(outcome.record.profilesId, /^flauz:prf:[0-9a-f]{16}$/);
                assert.equal(outcome.record.harnessId, HARNESS_ID);
                assert.equal(outcome.record.stage, 'composing');
                assert.deepStrictEqual(outcome.record.profiles, []);
                assert.equal(outcome.record.history.length, 1);
                assert.equal(outcome.record.history[0].fromStage, null);
                assert.equal(outcome.record.history[0].toStage, 'composing');
                assert.equal(outcome.record.history[0].op, 'begin-profiles');
        });

        test('bad-harness-id refuses (the REAL DH-01 alphabet)', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                for (const harnessId of ['flauz:prf:0123456789abcdef', 'flauz:hrn:0123456789ABCDEF', 'flauz:hrn:0123456789abcde', 7]) {
                        const refusal = refusalOf(await kit.beginProfiles(harnessId));
                        assert.equal(refusal.reason, 'bad-harness-id');
                        assert.equal(refusal.law, 'THE FAIL-CLOSED LAW');
                }
        });

        test('CORRUPT_SEAM: a non-16-hex rng read or a duplicate minted id', async () => {
                const bad = createProfilesKit({ clock: () => '2026-01-01T00:00:00.000Z', rng: () => '0123456789abcdef' });
                const first = await bad.beginProfiles(HARNESS_ID);
                assert.ok(first.ok);
                const second = refusalOf(await bad.beginProfiles(HARNESS_ID));
                assert.equal(second.reason, 'CORRUPT_SEAM');
                let call = 0;
                const flip = createProfilesKit({ clock: () => '2026-01-01T00:00:00.000Z', rng: () => (call++ === 0 ? '0123456789abcdef' : 'zzz') });
                const refusal = refusalOf(await flip.beginProfiles(HARNESS_ID));
                assert.equal(refusal.reason, 'CORRUPT_SEAM');
        });

        test('the begun session is listed by listProfilesSessions', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                const listed = await kit.listProfilesSessions();
                assert.ok(listed.ok);
                assert.equal(listed.records.length, 1);
                assert.equal(listed.records[0].profilesId, profilesId);
        });
});

suite('profilesKit · addProfile', () => {
        test('green: the profile lands with the add-profile self-edge note', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                const outcome = await kit.addProfile(profilesId, greenProfile());
                assert.ok(outcome.ok);
                assert.equal(outcome.record.profiles.length, 1);
                assert.deepStrictEqual(outcome.record.profiles[0], greenProfile());
                const note = outcome.record.history[outcome.record.history.length - 1];
                assert.equal(note.op, 'add-profile');
                assert.equal(note.fromStage, 'composing');
                assert.equal(note.toStage, 'composing');
        });

        test('the honest-gap law: empty permissionRefs, approvalTiers and kpiDimensions land', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                const profile = greenProfile();
                profile.permissionRefs = [];
                profile.approvalTiers = [];
                profile.kpiDimensions = [];
                const outcome = await kit.addProfile(profilesId, profile);
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.record.profiles[0].permissionRefs, []);
                assert.deepStrictEqual(outcome.record.profiles[0].approvalTiers, []);
                assert.deepStrictEqual(outcome.record.profiles[0].kpiDimensions, []);
        });

        test('a payload refusal carries the COMPLETE rejection table and leaves the record unchanged', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                const before = await kit.inspectProfiles(profilesId);
                const refusal = refusalOf(await kit.addProfile(profilesId, {
                        profileKey: ' x ',
                        summary: '',
                        permissionRefs: 'nope',
                        approvalTiers: 'nope',
                        evidenceFloor: 'staging',
                        kpiDimensions: 'nope',
                        executor: 1,
                }));
                assert.equal(refusal.reason, 'no-fork');
                assert.ok(refusal.rejections !== undefined);
                assert.deepStrictEqual(refusal.rejections.map((rejection) => rejection.reason), [
                        'no-fork',
                        'profile-key-whitespace',
                        'summary-length',
                        'bad-permission-refs-carrier',
                        'bad-approval-tiers-carrier',
                        'bad-evidence-floor',
                        'bad-kpi-dimensions-carrier',
                ]);
                const after = await kit.inspectProfiles(profilesId);
                assert.deepStrictEqual(after, before);
        });

        test('THE AUTHORITY-BINDING LAW through the kit: a non-catalog permissionRef refuses with the complete table', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                const before = await kit.inspectProfiles(profilesId);
                const profile = greenProfile();
                profile.permissionRefs = ['read-files', 'root-access'];
                const refusal = refusalOf(await kit.addProfile(profilesId, profile));
                assert.equal(refusal.reason, 'bad-permission-ref');
                assert.equal(refusal.law, 'THE AUTHORITY-BINDING LAW');
                assert.deepStrictEqual(refusal.items, ['root-access']);
                assert.deepStrictEqual(await kit.inspectProfiles(profilesId), before);
        });

        test('THE AUTHORITY-BINDING LAW through the kit: a non-risk-tier approvalTier refuses', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                const profile = greenProfile();
                profile.approvalTiers = ['none', 'critical'];
                const refusal = refusalOf(await kit.addProfile(profilesId, profile));
                assert.equal(refusal.reason, 'bad-approval-tier');
                assert.equal(refusal.law, 'THE AUTHORITY-BINDING LAW');
                assert.deepStrictEqual(refusal.items, ['none', 'critical']);
        });

        test('THE AUTHORITY-BINDING LAW through the kit: a non-ladder evidenceFloor refuses', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                const profile = greenProfile();
                profile.evidenceFloor = 'staging';
                const refusal = refusalOf(await kit.addProfile(profilesId, profile));
                assert.equal(refusal.reason, 'bad-evidence-floor');
                assert.equal(refusal.law, 'THE AUTHORITY-BINDING LAW');
        });

        test('THE AUTHORITY-BINDING LAW through the kit: a non-member kpiDimension refuses', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                const profile = greenProfile();
                profile.kpiDimensions = ['success', 'throughput'];
                const refusal = refusalOf(await kit.addProfile(profilesId, profile));
                assert.equal(refusal.reason, 'bad-kpi-dimension');
                assert.equal(refusal.law, 'THE AUTHORITY-BINDING LAW');
                assert.deepStrictEqual(refusal.items, ['throughput']);
        });

        test('duplicate permissionRefs / approvalTiers / kpiDimensions refuse their own stations', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                const duplicatedPermissions = greenProfile();
                duplicatedPermissions.permissionRefs = ['read-files', 'write-workspace', 'read-files'];
                assert.equal(refusalOf(await kit.addProfile(profilesId, duplicatedPermissions)).reason, 'duplicate-permission-ref');
                const duplicatedTiers = greenProfile();
                duplicatedTiers.approvalTiers = ['low', 'high', 'low'];
                assert.equal(refusalOf(await kit.addProfile(profilesId, duplicatedTiers)).reason, 'duplicate-approval-tier');
                const duplicatedDims = greenProfile();
                duplicatedDims.kpiDimensions = ['success', 'cost', 'success'];
                assert.equal(refusalOf(await kit.addProfile(profilesId, duplicatedDims)).reason, 'duplicate-kpi-dimension');
        });

        test('duplicate-profile-key refuses and leaves the record unchanged', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                const before = await kit.inspectProfiles(profilesId);
                const duplicate = greenProfile();
                duplicate.summary = 'Again.';
                const refusal = refusalOf(await kit.addProfile(profilesId, duplicate));
                assert.equal(refusal.reason, 'duplicate-profile-key');
                assert.deepStrictEqual(refusal.items, ['core']);
                assert.deepStrictEqual(await kit.inspectProfiles(profilesId), before);
        });

        test('exactly 64 profiles compose; the 65th refuses max-profiles', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                for (let index = 0; index < 64; index += 1) {
                        const profile = greenProfile();
                        profile.profileKey = `p${String(index).padStart(2, '0')}`;
                        await addProfileGreen(kit, profilesId, profile);
                }
                const atBound = await kit.inspectProfiles(profilesId);
                assert.ok(atBound.ok);
                assert.equal(atBound.record.profiles.length, 64);
                const oneTooMany = greenProfile();
                oneTooMany.profileKey = 'p64';
                const refusal = refusalOf(await kit.addProfile(profilesId, oneTooMany));
                assert.equal(refusal.reason, 'max-profiles');
        });

        test('unknown-record (malformed or unresolved id) and stale-stage refuse', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(refusalOf(await kit.addProfile('nope', greenProfile())).reason, 'unknown-record');
                assert.equal(refusalOf(await kit.addProfile('flauz:prf:ffffffffffffffff', greenProfile())).reason, 'unknown-record');
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                assert.ok((await kit.finalizeProfiles(profilesId)).ok);
                const late = greenProfile();
                late.profileKey = 'later';
                assert.equal(refusalOf(await kit.addProfile(profilesId, late)).reason, 'stale-stage');
        });
});

suite('profilesKit · replaceProfileSummary', () => {
        test('green: ONLY the summary changes (the five other parts are immutable)', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                const outcome = await kit.replaceProfileSummary(profilesId, 'core', 'The standing core policy profile.');
                assert.ok(outcome.ok);
                assert.equal(outcome.record.profiles[0].profileKey, 'core');
                assert.equal(outcome.record.profiles[0].summary, 'The standing core policy profile.');
                assert.deepStrictEqual(outcome.record.profiles[0].permissionRefs, ['read-files', 'network-access']);
                assert.deepStrictEqual(outcome.record.profiles[0].approvalTiers, ['high']);
                assert.equal(outcome.record.profiles[0].evidenceFloor, 'local-real');
                assert.deepStrictEqual(outcome.record.profiles[0].kpiDimensions, ['success', 'cost']);
                const note = outcome.record.history[outcome.record.history.length - 1];
                assert.equal(note.op, 'replace-profile-summary');
                assert.equal(note.law, 'THE REMOVE+RE-ADD LAW');
        });

        test('unknown-profile refuses (missing or malformed profileKey)', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                assert.equal(refusalOf(await kit.replaceProfileSummary(profilesId, 'ghost', 's')).reason, 'unknown-profile');
                assert.equal(refusalOf(await kit.replaceProfileSummary(profilesId, 7, 's')).reason, 'unknown-profile');
        });

        test('an invalid summary carries the COMPLETE table and leaves the record unchanged', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                const before = await kit.inspectProfiles(profilesId);
                const refusal = refusalOf(await kit.replaceProfileSummary(profilesId, 'core', ''));
                assert.equal(refusal.reason, 'summary-length');
                assert.ok(refusal.rejections !== undefined);
                assert.deepStrictEqual(refusal.rejections.map((rejection) => rejection.reason), ['summary-length']);
                assert.deepStrictEqual(await kit.inspectProfiles(profilesId), before);
        });

        test('stale-stage refuses on a composed record', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                assert.ok((await kit.finalizeProfiles(profilesId)).ok);
                assert.equal(refusalOf(await kit.replaceProfileSummary(profilesId, 'core', 'Late.')).reason, 'stale-stage');
        });
});

suite('profilesKit · removeProfile', () => {
        test('green: the profile leaves with the remove note', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                const extra = greenProfile();
                extra.profileKey = 'extra';
                await addProfileGreen(kit, profilesId, extra);
                const outcome = await kit.removeProfile(profilesId, 'core');
                assert.ok(outcome.ok);
                assert.equal(outcome.record.profiles.length, 1);
                assert.equal(outcome.record.profiles[0].profileKey, 'extra');
                assert.equal(outcome.record.history[outcome.record.history.length - 1].op, 'remove-profile');
        });

        test('removing the LAST profile is LEGAL while composing; the floor never dips below zero', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                const outcome = await kit.removeProfile(profilesId, 'core');
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.record.profiles, []);
                // an empty record's remove is unknown-profile (the floor never dips below zero)
                assert.equal(refusalOf(await kit.removeProfile(profilesId, 'core')).reason, 'unknown-profile');
        });

        test('unknown-profile refuses', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                assert.equal(refusalOf(await kit.removeProfile(profilesId, 'ghost')).reason, 'unknown-profile');
        });

        test('THE REMOVE+RE-ADD LAW: a changed profileKey is a NEW profile (remove, then re-add)', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                assert.ok((await kit.removeProfile(profilesId, 'core')).ok);
                const reborn = greenProfile();
                reborn.profileKey = 'deep-core';
                reborn.evidenceFloor = 'runtime-real';
                const outcome = await kit.addProfile(profilesId, reborn);
                assert.ok(outcome.ok);
                assert.equal(outcome.record.profiles[0].profileKey, 'deep-core');
                assert.equal(outcome.record.profiles[0].evidenceFloor, 'runtime-real');
        });
});

suite('profilesKit · finalizeProfiles', () => {
        test('the empty-profiles floor refuses empty-profiles (the boundary, never the record shape)', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                const before = await kit.inspectProfiles(profilesId);
                const refusal = refusalOf(await kit.finalizeProfiles(profilesId));
                assert.equal(refusal.reason, 'empty-profiles');
                assert.equal(refusal.law, 'THE FAIL-CLOSED LAW');
                assert.deepStrictEqual(refusal.items, ['profiles']);
                assert.deepStrictEqual(await kit.inspectProfiles(profilesId), before);
        });

        test('green: composing -> composed, TERMINAL, profiles carried, the finalize note', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                const outcome = await kit.finalizeProfiles(profilesId);
                assert.ok(outcome.ok);
                assert.equal(outcome.record.stage, 'composed');
                assert.equal(outcome.record.profiles.length, 1);
                const note = outcome.record.history[outcome.record.history.length - 1];
                assert.equal(note.op, 'finalize-profiles');
                assert.equal(note.fromStage, 'composing');
                assert.equal(note.toStage, 'composed');
                assert.equal(note.law, 'THE AUTHORITY-BINDING LAW');
        });

        test('after compose: every mutating op refuses stale-stage', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                assert.ok((await kit.finalizeProfiles(profilesId)).ok);
                const late = greenProfile();
                late.profileKey = 'late';
                assert.equal(refusalOf(await kit.addProfile(profilesId, late)).reason, 'stale-stage');
                assert.equal(refusalOf(await kit.replaceProfileSummary(profilesId, 'core', 'Late.')).reason, 'stale-stage');
                assert.equal(refusalOf(await kit.removeProfile(profilesId, 'core')).reason, 'stale-stage');
                assert.equal(refusalOf(await kit.finalizeProfiles(profilesId)).reason, 'stale-stage');
        });

        test('the composed record carries the canonical profile order (sorted by profileKey)', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                const zulu = greenProfile();
                zulu.profileKey = 'zulu';
                await addProfileGreen(kit, profilesId, zulu);
                await addProfileGreen(kit, profilesId, greenProfile());
                const outcome = await kit.finalizeProfiles(profilesId);
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.record.profiles.map((profile) => profile.profileKey), ['core', 'zulu']);
        });

        test('the honest-gap law: a profile with all-empty vocabularies finalizes green', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                const profile = greenProfile();
                profile.permissionRefs = [];
                profile.approvalTiers = [];
                profile.kpiDimensions = [];
                await addProfileGreen(kit, profilesId, profile);
                const outcome = await kit.finalizeProfiles(profilesId);
                assert.ok(outcome.ok);
                assert.equal(outcome.record.stage, 'composed');
        });

        test('the frozen-record semantics: two finalize runs over identical seams serialize byte-equal', async () => {
                const run = async (): Promise<string> => {
                        const seams = makeSeams();
                        const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                        const profilesId = await beginGreen(kit);
                        await addProfileGreen(kit, profilesId, greenProfile());
                        const finalized = await kit.finalizeProfiles(profilesId);
                        if (!finalized.ok) {
                                throw new Error(`finalizeProfiles refused: ${finalized.refusal.reason}`);
                        }
                        return serializeProfilesRecord(finalized.record);
                };
                assert.equal(await run(), await run());
        });

        test('the boundary re-proves every vocabulary: the composed record passes the contract deep walk', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                const outcome = await kit.finalizeProfiles(profilesId);
                assert.ok(outcome.ok);
                const bytes = serializeProfilesRecord(outcome.record);
                const reparsed = JSON.parse(bytes) as { profiles: { permissionRefs: string[]; approvalTiers: string[]; evidenceFloor: string; kpiDimensions: string[] }[] };
                for (const profile of reparsed.profiles) {
                        for (const ref of profile.permissionRefs) {
                                assert.ok(REAL_isCatalogPermissionId(ref), `the composed permissionRef '${ref}' must be a REAL catalog member`);
                        }
                        for (const tier of profile.approvalTiers) {
                                assert.ok(REAL_isCatalogPermissionRiskTier(tier), `the composed approvalTier '${tier}' must be a REAL risk tier`);
                        }
                        assert.ok((PROFILES_EVIDENCE_LADDER as readonly string[]).includes(profile.evidenceFloor), `the composed evidenceFloor '${profile.evidenceFloor}' must be a REAL ladder rung`);
                        for (const dimension of profile.kpiDimensions) {
                                assert.ok((PROFILES_EVAL_DIMENSIONS as readonly string[]).includes(dimension), `the composed kpiDimension '${dimension}' must be a REAL eval dimension`);
                        }
                }
        });
});

suite('profilesKit · emitPolicyRef / emitEvidenceRef', () => {
        test('premature-op on a composing record (both emits)', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                const policyRefusal = refusalOf(await kit.emitPolicyRef(profilesId));
                assert.equal(policyRefusal.reason, 'premature-op');
                assert.equal(policyRefusal.law, 'THE FORWARD-ONLY LAW');
                const evidenceRefusal = refusalOf(await kit.emitEvidenceRef(profilesId));
                assert.equal(evidenceRefusal.reason, 'premature-op');
        });

        test('green on a composed record: the policyRef is the record id', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                assert.ok((await kit.finalizeProfiles(profilesId)).ok);
                const outcome = await kit.emitPolicyRef(profilesId);
                assert.ok(outcome.ok);
                assert.equal(outcome.policyRef, profilesId);
                assert.match(outcome.policyRef, /^flauz:prf:[0-9a-f]{16}$/);
        });

        test('green on a composed record: the evidenceRef is the record id', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                assert.ok((await kit.finalizeProfiles(profilesId)).ok);
                const outcome = await kit.emitEvidenceRef(profilesId);
                assert.ok(outcome.ok);
                assert.equal(outcome.evidenceRef, profilesId);
                assert.match(outcome.evidenceRef, /^flauz:prf:[0-9a-f]{16}$/);
        });

        test('unknown-record refuses (both emits)', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                assert.equal(refusalOf(await kit.emitPolicyRef('flauz:prf:ffffffffffffffff')).reason, 'unknown-record');
                assert.equal(refusalOf(await kit.emitEvidenceRef('flauz:prf:ffffffffffffffff')).reason, 'unknown-record');
        });

        test('the emits are pure reads: no ledger line, deterministic on repeat', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                assert.ok((await kit.finalizeProfiles(profilesId)).ok);
                const linesBefore = (port.dump(`ws/${PROFILES_LEDGER_RELATIVE_PATH}`) as string).split('\n').length - 1;
                const first = await kit.emitPolicyRef(profilesId);
                const second = await kit.emitPolicyRef(profilesId);
                const evidence = await kit.emitEvidenceRef(profilesId);
                assert.ok(first.ok && second.ok && evidence.ok);
                assert.equal(first.policyRef, second.policyRef);
                assert.equal(first.policyRef, evidence.evidenceRef);
                const linesAfter = (port.dump(`ws/${PROFILES_LEDGER_RELATIVE_PATH}`) as string).split('\n').length - 1;
                assert.equal(linesAfter, linesBefore);
        });
});

suite('profilesKit · listProfilesSessions', () => {
        test('the stage and harnessId filters select; the records are id-ordered canonical copies', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const first = await beginGreen(kit);
                await addProfileGreen(kit, first, greenProfile());
                assert.ok((await kit.finalizeProfiles(first)).ok);
                const second = await beginGreen(kit);
                const composing = await kit.listProfilesSessions({ stage: 'composing' });
                assert.ok(composing.ok);
                assert.deepStrictEqual(composing.records.map((record) => record.profilesId), [second]);
                const composed = await kit.listProfilesSessions({ stage: 'composed' });
                assert.ok(composed.ok);
                assert.deepStrictEqual(composed.records.map((record) => record.profilesId), [first]);
                const byHarness = await kit.listProfilesSessions({ harnessId: HARNESS_ID });
                assert.ok(byHarness.ok);
                assert.equal(byHarness.records.length, 2);
                const none = await kit.listProfilesSessions({ harnessId: 'flauz:hrn:ffffffffffffffff' });
                assert.ok(none.ok);
                assert.deepStrictEqual(none.records, []);
        });

        test('UNKNOWN_FILTER: an unknown field, a non-member stage, a bad harnessId, a non-object filter', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                await beginGreen(kit);
                assert.equal(refusalOf(await kit.listProfilesSessions({ industry: 'software' })).reason, 'UNKNOWN_FILTER');
                assert.equal(refusalOf(await kit.listProfilesSessions({ stage: 'draft' })).reason, 'UNKNOWN_FILTER');
                assert.equal(refusalOf(await kit.listProfilesSessions({ harnessId: 'bad' })).reason, 'UNKNOWN_FILTER');
                assert.equal(refusalOf(await kit.listProfilesSessions('nope' as never)).reason, 'UNKNOWN_FILTER');
        });
});

suite('profilesKit · THE CROSS-KIT INTEGRATION PINS (the wave crown)', () => {
        test('the crown: the REAL DH-01 harness kit -> this kit -> finalize -> emit -> the REAL review-composition validator passes with the policyRefs / evidenceRefs families', async () => {
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
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const begun = await kit.beginProfiles(harnessId);
                assert.ok(begun.ok);
                const profilesId = begun.record.profilesId;
                assert.ok((await kit.addProfile(profilesId, greenProfile())).ok);
                const finalized = await kit.finalizeProfiles(profilesId);
                assert.ok(finalized.ok);
                assert.equal(finalized.record.stage, 'composed');
                const emittedPolicy = await kit.emitPolicyRef(profilesId);
                assert.ok(emittedPolicy.ok);
                const emittedEvidence = await kit.emitEvidenceRef(profilesId);
                assert.ok(emittedEvidence.ok);
                // the emitted refs ride the REAL review composition's policyRefs /
                // evidenceRefs families (the landed DH-02 schema's policy-side and
                // evidence-side slots for the domain's default profiles).
                const composition = validateOnboardingReviewComposition({
                        roles: [
                                { roleKey: 'analyst', summary: 'Runs the domain analysis.' },
                                { roleKey: 'reviewer', summary: 'Reviews the domain work.' },
                        ],
                        capabilityRefs: [],
                        workflowRefs: [],
                        policyRefs: [emittedPolicy.policyRef],
                        evidenceRefs: [emittedEvidence.evidenceRef],
                });
                assert.ok(composition.ok);
                assert.deepStrictEqual(composition.value.policyRefs, [emittedPolicy.policyRef]);
                assert.deepStrictEqual(composition.value.evidenceRefs, [emittedEvidence.evidenceRef]);
        });

        test('the crown negative: a composition MISSING the emitted refs (the family keys absent) refuses the REAL walk', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                assert.ok((await kit.finalizeProfiles(profilesId)).ok);
                const emitted = await kit.emitPolicyRef(profilesId);
                assert.ok(emitted.ok);
                // the policyRefs / evidenceRefs keys are absent: the REAL walk's
                // missing-key refusal (a composition cannot silently drop a ref family).
                const missing = validateOnboardingReviewComposition({
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [],
                        workflowRefs: [],
                });
                assert.ok(!missing.ok);
                assert.equal(missing.refusal.reason, 'missing-key');
        });

        test('the crown family form: a duplicate or non-string member in the ref families refuses the REAL validator', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                assert.ok((await kit.finalizeProfiles(profilesId)).ok);
                const emitted = await kit.emitEvidenceRef(profilesId);
                assert.ok(emitted.ok);
                const green = validateOnboardingReviewComposition({
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [emitted.evidenceRef],
                });
                assert.ok(green.ok);
                const duplicated = validateOnboardingReviewComposition({
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [emitted.evidenceRef, emitted.evidenceRef],
                });
                assert.ok(!duplicated.ok);
                assert.equal(duplicated.refusal.reason, 'duplicate-ref');
                const malformed = validateOnboardingReviewComposition({
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [],
                        workflowRefs: [],
                        policyRefs: [emitted.evidenceRef, 7],
                        evidenceRefs: [],
                });
                assert.ok(!malformed.ok);
                assert.equal(malformed.refusal.reason, 'malformed-refs');
        });

        test('the crown vocabulary: the composed profile\'s parts are REAL authority members (the emitted record binds to the real vocabularies)', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                const finalized = await kit.finalizeProfiles(profilesId);
                assert.ok(finalized.ok);
                const profile = finalized.record.profiles[0];
                for (const ref of profile.permissionRefs) {
                        assert.ok(REAL_isCatalogPermissionId(ref), `'${ref}' must be a REAL catalog permission`);
                }
                for (const tier of profile.approvalTiers) {
                        assert.ok(REAL_isCatalogPermissionRiskTier(tier), `'${tier}' must be a REAL risk tier`);
                }
                assert.ok((PROFILES_EVIDENCE_LADDER as readonly string[]).includes(profile.evidenceFloor), `'${profile.evidenceFloor}' must be a REAL ladder rung`);
                for (const dimension of profile.kpiDimensions) {
                        assert.ok((PROFILES_EVAL_DIMENSIONS as readonly string[]).includes(dimension), `'${dimension}' must be a REAL eval dimension`);
                }
        });
});

suite('profilesKit · persistence (the PIN-2 mirror)', () => {
        test('the ledger and the envelope land lazily at the distinct family paths', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.equal(port.dump('ws/.flauz/harness/profiles-ops.jsonl'), undefined);
                const profilesId = await beginGreen(kit);
                const ledger = port.dump(`ws/${PROFILES_LEDGER_RELATIVE_PATH}`);
                assert.ok(ledger !== undefined && ledger.endsWith('\n'));
                assert.equal(ledger.split('\n').length - 1, 1);
                // the canonical line discipline: the frozen eleven-key schema, the seq equal
                // to the line number, the contract version on every line, a null begin payload.
                const line = JSON.parse((ledger as string).split('\n')[0]) as Record<string, unknown>;
                assert.deepStrictEqual(Object.keys(line).sort(), [...PROFILES_LEDGER_LINE_SCHEMA_KEYS].sort());
                assert.equal(line.seq, 1);
                assert.equal(line.contractVersion, PROFILES_CONTRACTS_VERSION);
                assert.equal(line.profilesId, profilesId);
                assert.equal(line.harnessId, HARNESS_ID);
                assert.equal(line.payload, null);
                const envelope = port.dump(`ws/${PROFILES_ENVELOPE_RELATIVE_PATH}`);
                assert.ok(envelope !== undefined);
                const parsed = JSON.parse(envelope as string) as { contractVersion: string; seq: number; records: unknown[] };
                assert.equal(parsed.contractVersion, PROFILES_CONTRACTS_VERSION);
                assert.equal(parsed.seq, 1);
                assert.equal(parsed.records.length, 1);
        });

        test('restart replay is byte-identical and the seq continues', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const first = await beginGreen(kit);
                await addProfileGreen(kit, first, greenProfile());
                const second = await beginGreen(kit);
                const beforeFirst = await kit.inspectProfiles(first);
                assert.ok(beforeFirst.ok);
                const reloaded = await loadProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                const afterFirst = await reloaded.kit.inspectProfiles(first);
                assert.ok(afterFirst.ok);
                assert.deepStrictEqual(afterFirst, beforeFirst);
                assert.equal(serializeProfilesRecord(afterFirst.record), serializeProfilesRecord(beforeFirst.record));
                const extra = greenProfile();
                extra.profileKey = 'extra';
                assert.ok((await reloaded.kit.addProfile(second, extra)).ok);
                const ledger = port.dump(`ws/${PROFILES_LEDGER_RELATIVE_PATH}`) as string;
                assert.equal(ledger.split('\n').length - 1, 4);
                // the seq equals the line number on every line (the append-only ledger law).
                const ledgerLines = ledger.split('\n');
                ledgerLines.pop();
                for (let i = 0; i < ledgerLines.length; i += 1) {
                        const parsedLine = JSON.parse(ledgerLines[i]) as { seq: number };
                        assert.equal(parsedLine.seq, i + 1);
                }
                const envelope = JSON.parse(port.dump(`ws/${PROFILES_ENVELOPE_RELATIVE_PATH}`) as string) as { seq: number };
                assert.equal(envelope.seq, 4);
        });

        test('a torn ledger (no trailing newline) is E_LEDGER_TORN', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                const ledgerPath = `ws/${PROFILES_LEDGER_RELATIVE_PATH}`;
                port.overwrite(ledgerPath, (port.dump(ledgerPath) as string).slice(0, -1));
                const outcome = await loadProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_LEDGER_TORN');
        });

        test('a content-divergent envelope is E_ENVELOPE_MISMATCH (never silently rebuilt)', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                const envelopePath = `ws/${PROFILES_ENVELOPE_RELATIVE_PATH}`;
                const parsed = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: Record<string, unknown>[] };
                parsed.records[0].profiles = [];
                port.overwrite(envelopePath, JSON.stringify(parsed));
                const outcome = await loadProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
        });

        test('a missing envelope while the ledger carries lines is E_ENVELOPE_MISMATCH', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                port.remove(`ws/${PROFILES_ENVELOPE_RELATIVE_PATH}`);
                const outcome = await loadProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
        });

        test('an envelope seq ahead is E_LEDGER_TORN; behind is E_ENVELOPE_MISMATCH', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                await beginGreen(kit);
                const envelopePath = `ws/${PROFILES_ENVELOPE_RELATIVE_PATH}`;
                const ahead = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: unknown[] };
                ahead.seq = 3;
                port.overwrite(envelopePath, JSON.stringify(ahead));
                const aheadOutcome = await loadProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!aheadOutcome.ok);
                assert.equal(aheadOutcome.refusal.reason, 'E_LEDGER_TORN');
                const behind = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: unknown[] };
                behind.seq = 1;
                port.overwrite(envelopePath, JSON.stringify(behind));
                const behindOutcome = await loadProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!behindOutcome.ok);
                assert.equal(behindOutcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
        });

        test('the multi-record ledger replays both records in id order (one composed, one composing)', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const first = await beginGreen(kit);
                const second = await beginGreen(kit);
                await addProfileGreen(kit, first, greenProfile());
                assert.ok((await kit.finalizeProfiles(first)).ok);
                const reloaded = await loadProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                const listed = await reloaded.kit.listProfilesSessions();
                assert.ok(listed.ok);
                assert.equal(listed.records.length, 2);
                assert.deepStrictEqual(listed.records.map((record) => record.profilesId), [first, second].sort());
                const composed = await reloaded.kit.inspectProfiles(first);
                assert.ok(composed.ok);
                assert.equal(composed.record.stage, 'composed');
                // the composed record still emits after the restart
                const emitted = await reloaded.kit.emitPolicyRef(first);
                assert.ok(emitted.ok);
                assert.equal(emitted.policyRef, first);
        });

        test('a fresh kit never appends over a non-empty ledger (E_LEDGER_TORN)', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                const ledgerPath = `ws/${PROFILES_LEDGER_RELATIVE_PATH}`;
                const lineCount = (port.dump(ledgerPath) as string).split('\n').length - 1;
                const fresh = createProfilesKit({ clock: seams.clock, rng: makeSeams().rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const refusal = refusalOf(await fresh.beginProfiles(HARNESS_ID));
                assert.equal(refusal.reason, 'E_LEDGER_TORN');
                assert.equal((port.dump(ledgerPath) as string).split('\n').length - 1, lineCount);
        });

        test('a tampered contractVersion is the typed version-mismatch', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                await beginGreen(kit);
                const ledgerPath = `ws/${PROFILES_LEDGER_RELATIVE_PATH}`;
                const lines = (port.dump(ledgerPath) as string).split('\n');
                const first = JSON.parse(lines[0]) as Record<string, unknown>;
                first.contractVersion = '9.9.9';
                lines[0] = JSON.stringify(first);
                port.overwrite(ledgerPath, `${lines.join('\n')}\n`);
                const outcome = await loadProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'version-mismatch');
        });

        test('a tampered add-line payload (a non-catalog permissionRef injected) is E_LEDGER_TORN - THE AUTHORITY-BINDING LAW re-proved from the ledger alone', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                assert.ok((await kit.finalizeProfiles(profilesId)).ok);
                const ledgerPath = `ws/${PROFILES_LEDGER_RELATIVE_PATH}`;
                const lines = (port.dump(ledgerPath) as string).split('\n');
                const addLine = JSON.parse(lines[1]) as { payload: { permissionRefs: string[] } };
                addLine.payload.permissionRefs = ['root-access'];
                lines[1] = JSON.stringify(addLine);
                port.overwrite(ledgerPath, `${lines.join('\n')}\n`);
                const outcome = await loadProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_LEDGER_TORN');
        });

        test('a hand-written finalize line over an EMPTY record is E_LEDGER_TORN (the empty floor re-proved)', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const profilesId = await beginGreen(kit);
                const ledgerPath = `ws/${PROFILES_LEDGER_RELATIVE_PATH}`;
                const beginLine = (port.dump(ledgerPath) as string).split('\n')[0];
                const finalizeLine = JSON.stringify({
                        seq: 2,
                        at: '2026-01-01T00:00:00.000Z',
                        contractVersion: PROFILES_CONTRACTS_VERSION,
                        op: 'finalize-profiles',
                        profilesId,
                        harnessId: HARNESS_ID,
                        fromStage: 'composing',
                        toStage: 'composed',
                        law: 'THE AUTHORITY-BINDING LAW',
                        payload: null,
                        detail: 'finalized an empty record',
                });
                port.overwrite(ledgerPath, `${beginLine}${finalizeLine}\n`);
                const outcome = await loadProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_LEDGER_TORN');
        });

        test('a tampered replace line (the vocabulary parts changed) is E_LEDGER_TORN (THE REMOVE+RE-ADD cross-check)', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                assert.ok((await kit.replaceProfileSummary(profilesId, 'core', 'The standing core policy profile.')).ok);
                const ledgerPath = `ws/${PROFILES_LEDGER_RELATIVE_PATH}`;
                const lines = (port.dump(ledgerPath) as string).split('\n');
                const replaceLine = JSON.parse(lines[2]) as { payload: { approvalTiers: string[] } };
                replaceLine.payload.approvalTiers = ['low'];
                lines[2] = JSON.stringify(replaceLine);
                port.overwrite(ledgerPath, `${lines.join('\n')}\n`);
                const outcome = await loadProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_LEDGER_TORN');
        });

        test('a tampered remove line (the entry not as it stood) is E_LEDGER_TORN', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                const extra = greenProfile();
                extra.profileKey = 'extra';
                await addProfileGreen(kit, profilesId, extra);
                assert.ok((await kit.removeProfile(profilesId, 'core')).ok);
                const ledgerPath = `ws/${PROFILES_LEDGER_RELATIVE_PATH}`;
                const lines = (port.dump(ledgerPath) as string).split('\n');
                const removeLine = JSON.parse(lines[3]) as { payload: { summary: string } };
                removeLine.payload.summary = 'A summary that never stood.';
                lines[3] = JSON.stringify(removeLine);
                port.overwrite(ledgerPath, `${lines.join('\n')}\n`);
                const outcome = await loadProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'E_LEDGER_TORN');
        });

        test('the finalize line carries a null payload (no injected authority at the boundary)', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                assert.ok((await kit.finalizeProfiles(profilesId)).ok);
                const lines = (port.dump(`ws/${PROFILES_LEDGER_RELATIVE_PATH}`) as string).split('\n');
                const last = JSON.parse(lines[lines.length - 2]) as { op: string; payload: unknown; fromStage: string; toStage: string; law: string };
                assert.equal(last.op, 'finalize-profiles');
                assert.equal(last.payload, null);
                assert.equal(last.fromStage, 'composing');
                assert.equal(last.toStage, 'composed');
                assert.equal(last.law, 'THE AUTHORITY-BINDING LAW');
        });

        test('PROFILES_IO: a refusing append leaves NOTHING applied (the record never began)', async () => {
                const seams = makeSeams();
                const port = new RefusingAppendFsPort();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const refusal = refusalOf(await kit.beginProfiles(HARNESS_ID));
                assert.equal(refusal.reason, 'PROFILES_IO');
                assert.equal(refusal.detail.includes('nothing was applied'), true);
                const listed = await kit.listProfilesSessions();
                assert.ok(listed.ok);
                assert.deepStrictEqual(listed.records, []);
                assert.equal(port.dump(`ws/${PROFILES_LEDGER_RELATIVE_PATH}`), undefined);
        });

        test('PROFILES_IO: a refusing mkdir fails the load closed', async () => {
                const seams = makeSeams();
                const port = new RefusingMkdirFsPort();
                const outcome = await loadProfilesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.refusal.reason, 'PROFILES_IO');
        });
});

suite('profilesKit · dispose and determinism', () => {
        test('THE DISPOSE LAW: every operation after disposeProfiles rejects', async () => {
                const seams = makeSeams();
                const kit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
                const profilesId = await beginGreen(kit);
                await addProfileGreen(kit, profilesId, greenProfile());
                assert.ok((await kit.finalizeProfiles(profilesId)).ok);
                kit.disposeProfiles();
                assert.equal(refusalOf(await kit.beginProfiles(HARNESS_ID)).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.addProfile(profilesId, greenProfile())).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.replaceProfileSummary(profilesId, 'core', 's')).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.removeProfile(profilesId, 'core')).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.finalizeProfiles(profilesId)).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.emitPolicyRef(profilesId)).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.emitEvidenceRef(profilesId)).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.inspectProfiles(profilesId)).reason, 'DISPOSED');
                assert.equal(refusalOf(await kit.listProfilesSessions()).reason, 'DISPOSED');
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

        test('determinism greps over the contract module: law-comment lines only (the kit battery re-pin)', () => {
                const contractSource = readFileSync(fileURLToPath(new URL('../../common/profilesContract.ts', import.meta.url)), 'utf8');
                const pattern = /Date\.now|Math\.random|new Date\(|process\.env/;
                const matches = contractSource.split('\n').filter((line) => pattern.test(line));
                assert.ok(matches.length > 0, 'the greps must actually match the law-comment lines');
                const offending = matches.filter((line) => {
                        const trimmed = line.trim();
                        return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//');
                });
                assert.deepStrictEqual(offending, [], 'no executable line may carry the forbidden tokens');
        });
});
