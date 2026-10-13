/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-003 roles kit: the deterministic composition runtime over the
 * roles contract vocabulary. THE STATELESS DESIGN (deliberate and
 * disclosed): the instrument is PURE over the frozen catalogs - the
 * factory takes ONLY the injected clock (no rng: the kit mints no ids;
 * no fsPort/root: the DH-002 onboarding session owns persistence, the
 * kit composes stateless suggestions and selections; no catalog seam:
 * the catalogs are the frozen contract configuration, imported by
 * reference - never a copy, never an injectable). suggestComposition is
 * THE COMPOSITION LAW's engine: the request walk (the frozen
 * vocabularies), then the union of the requested work-type affinities
 * INTERSECTED with the industry's catalog, ordered by the catalog's own
 * order, deduplicated, each entry carrying its provenance (the
 * contributing work types, in the frozen list order), stamped with the
 * injected clock's reading (carried verbatim - the kit never reads a
 * clock itself) into the composition record. validateSelection walks
 * the explicit user selection against the industry's catalog (every
 * roleKey a member; the resolved templates in catalog order).
 * inspectCatalog is the read surface (the frozen catalog BY REFERENCE,
 * never a copy). The composition output composes directly into the
 * DH-002 review stage: the record's roles array is the DH-01 role shape
 * and is DIRECTLY admissible as composeDraft's roles input (THE
 * INTEGRATION LAW - battery-pinned through a REAL onboarding kit mint
 * in a temp root; role invention was deferred from DH-002 to THIS
 * family, and this kit is that instrument).
 *
 * LAWS (inherited binding from the contract module's header; the
 * contract module carries their enforcement surface):
 * - THE NO-FORK LAW: the request / selection walks reject execution
 *   material BEFORE any composition runs; a suggested role is always a
 *   catalog template (roleKey + summary ONLY).
 * - THE FROZEN-CATALOG LAW: the suggestion is the affinity union
 *   intersected with the industry's catalog, ordered by the catalog's
 *   own order; membership is the only admissibility; an empty
 *   intersection is the typed empty-composition refusal (the honest
 *   refusal, never a silent empty success).
 * - THE REAL-VOCABULARY LAW: the industries and the work types are the
 *   DH-01 contract's own bindings (re-exported by the contract module);
 *   the role shape is the DH-01 role shape.
 * - THE DETERMINISM LAW: no Math.random, no Date.now, no new Date(...)
 *   and no process.env in this module (law comments excepted) - the
 *   clock is the ONLY injected seam, read once per composition and
 *   carried verbatim into the record; same inputs (request + clock
 *   reading) produce byte-identical canonical bytes (the battery pins
 *   it across two independently constructed kits).
 * - THE FAIL-CLOSED LAW: factory misuse throws TypeError (the DH-01
 *   factory's exact message shapes, the createRolesKit prefix); every
 *   domain refusal is a typed record { reason, law, message, items? }
 *   naming the violated law and the offending items; no silent partial
 *   effects (a refused op composes nothing).
 * - THE SINGLE-VERSION LAW: ROLES_CONTRACTS_VERSION is declared ONCE
 *   in the contract module, re-carried by this kit (the re-export
 *   below); the battery pins both copies equal.
 * - THE DISPOSE LAW: every operation after dispose rejects with the
 *   typed disposed refusal.
 * - THE CORRUPT-SEAM LAW (the landed families' injected-seam guard):
 *   a clock that returns a malformed value mid-op (not a string, or
 *   empty) is the typed corrupt-seam refusal - the record carries an
 *   honest timestamp or none at all.
 */

import {
        INDUSTRY_ROLE_CATALOGS,
        ROLES_CONTRACTS_VERSION,
        ROLES_VALIDATION_REJECTION_REASONS,
        WORK_TYPE_ROLE_AFFINITIES,
        isHarnessIndustry,
        serializeRoleComposition,
        validateRoleCompositionRequest,
        validateRoleSelection,
} from './rolesContract.js';
import type {
        HarnessIndustry,
        HarnessRole,
        HarnessWorkType,
        RoleCompositionRecord,
        RoleSelection,
} from './rolesContract.js';

/** THE SINGLE-VERSION LAW: the kit re-carries the contract's version (declared ONCE there). */
export { ROLES_CONTRACTS_VERSION } from './rolesContract.js';

/**
 * The kit-layer refusal extras (the frozen list beyond the contract's
 * ROLES_VALIDATION_REJECTION_REASONS):
 *   disposed     - THE DISPOSE LAW: the kit was disposed; every
 *                  operation after dispose rejects;
 *   corrupt-seam - THE CORRUPT-SEAM LAW: the injected clock returned a
 *                  malformed value mid-op (not a string, or empty) -
 *                  the composition record carries an honest timestamp
 *                  or none at all.
 */
export const ROLES_KIT_EXTRA_REFUSAL_REASONS = [
        'disposed',
        'corrupt-seam',
] as const;

/** The frozen kit refusal vocabulary: the contract's 16 domain reasons plus the kit-layer extras. */
export const ROLES_KIT_REFUSAL_REASONS = [
        ...ROLES_VALIDATION_REJECTION_REASONS,
        ...ROLES_KIT_EXTRA_REFUSAL_REASONS,
] as const;
export type RolesKitRefusalReason = (typeof ROLES_KIT_REFUSAL_REASONS)[number];

/** Pure predicate over the closed kit-refusal list. */
export function isRolesKitRefusalReason(value: unknown): value is RolesKitRefusalReason {
        return (ROLES_KIT_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed kit refusal: the frozen reason, the violated law's name,
 * the deterministic message, and the optional offending items (the
 * contract's own refusal record shape, widened over the kit-layer
 * reason vocabulary).
 */
export interface RolesKitRefusal {
        readonly reason: RolesKitRefusalReason;
        readonly law: string;
        readonly message: string;
        readonly items?: readonly string[];
}

/**
 * The kit construction options (all injected, never env-read). The
 * clock is the ONLY seam: the instrument is STATELESS over the frozen
 * catalogs (no rng - the kit mints no ids; no fsPort / root - the
 * DH-002 onboarding session owns persistence; no catalog seam - the
 * catalogs are the frozen contract configuration, never injectable).
 */
export interface RolesKitOptions {
        /** The injected clock (returns the ISO string; carried verbatim into composition records - the kit never reads a clock itself). */
        readonly clock: () => string;
}

/** The suggestion outcome: ok carries the honest composition record; failure carries the typed refusal. */
export type RolesSuggestOutcome =
        | { readonly ok: true; readonly composition: RoleCompositionRecord }
        | { readonly ok: false; readonly refusal: RolesKitRefusal };

/** The selection outcome: ok carries the resolved selection (the templates in catalog order); failure carries the typed refusal. */
export type RolesSelectionOutcome =
        | { readonly ok: true; readonly selection: RoleSelection }
        | { readonly ok: false; readonly refusal: RolesKitRefusal };

/** The catalog-read outcome: ok carries the industry and the frozen catalog templates BY REFERENCE; failure carries the typed refusal. */
export type RolesCatalogOutcome =
        | { readonly ok: true; readonly industry: HarnessIndustry; readonly templates: readonly HarnessRole[] }
        | { readonly ok: false; readonly refusal: RolesKitRefusal };

/**
 * The deterministic roles kit (the stateless composition instrument):
 * every operation is async with a typed outcome ({ ok: true, ... } |
 * { ok: false, refusal }); every domain refusal names the violated law
 * and the offending items; every operation after dispose rejects.
 */
export interface RolesKit {
        suggestComposition(request: unknown): Promise<RolesSuggestOutcome>;
        validateSelection(request: unknown): Promise<RolesSelectionOutcome>;
        inspectCatalog(industry: unknown): Promise<RolesCatalogOutcome>;
        dispose(): void;
}

/**
 * Creates a roles kit (fail-closed factory). Validation order is
 * deterministic and mirrors the DH-01 factory's clock discipline
 * exactly (the createRolesKit prefix): the options shape, then the
 * clock's first read (a non-empty ISO string). THE STATELESS DESIGN:
 * no rng, no fsPort / root, no catalog seam - the instrument is pure
 * over the frozen catalogs (deliberate and disclosed; the DH-002
 * onboarding session owns persistence and the post-composition walk).
 */
export function createRolesKit(options: RolesKitOptions): RolesKit {
        const bound = validateKitOptions(options);
        let disposed = false;

        /** The disposed guard (THE DISPOSE LAW - the op-entry first station). */
        function refuseIfDisposed(opName: string): RolesKitRefusal | null {
                if (disposed) {
                        return {
                                reason: 'disposed',
                                law: 'THE DISPOSE LAW',
                                message: `${opName}: the kit was disposed - every operation after dispose rejects`,
                        };
                }
                return null;
        }

        /** The clock read (THE CORRUPT-SEAM LAW: an honest timestamp or none at all). */
        function readClock(opName: string): { at: string } | { refusal: RolesKitRefusal } {
                const at = bound.clock();
                if (typeof at !== 'string' || at.length === 0) {
                        return {
                                refusal: {
                                        reason: 'corrupt-seam',
                                        law: 'THE CORRUPT-SEAM LAW',
                                        message: `${opName}: the injected clock returned a malformed value mid-op (the timestamps are carried verbatim from the injected seam - an honest timestamp or none at all)`,
                                },
                        };
                }
                return { at };
        }

        return {
                async suggestComposition(request: unknown): Promise<RolesSuggestOutcome> {
                        const disposedRefusal = refuseIfDisposed('suggestComposition');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const verdict = validateRoleCompositionRequest(request);
                        if (!verdict.ok) {
                                return { ok: false, refusal: { ...verdict.refusal } };
                        }
                        const industry = verdict.value.industry;
                        const workTypes = verdict.value.workTypes;
                        const catalog = INDUSTRY_ROLE_CATALOGS[industry];
                        const catalogKeys = new Set<string>(catalog.map((template) => template.roleKey));
                        // THE COMPOSITION LAW: the union of the requested work-type affinities,
                        // INTERSECTED with the industry's catalog (affinity keys absent from this
                        // industry's catalog belong to other industries' vocabularies - the
                        // intersection is the composition rule, never a silent skip; the contract's
                        // integrity walk guarantees every affinity key resolves in at least ONE
                        // catalog). The contributors are collected per role key in the frozen
                        // work-type order (the request is already the frozen-ordered subset).
                        const contributors = new Map<string, HarnessWorkType[]>();
                        for (const workType of workTypes) {
                                for (const roleKey of WORK_TYPE_ROLE_AFFINITIES[workType]) {
                                        if (!catalogKeys.has(roleKey)) {
                                                continue;
                                        }
                                        const existing = contributors.get(roleKey);
                                        if (existing === undefined) {
                                                contributors.set(roleKey, [workType]);
                                        } else {
                                                existing.push(workType);
                                        }
                                }
                        }
                        if (contributors.size === 0) {
                                return {
                                        ok: false,
                                        refusal: {
                                                reason: 'empty-composition',
                                                law: 'THE COMPOSITION LAW',
                                                message: `suggestComposition: the requested work-type affinity union intersects the '${industry}' industry's frozen catalog in NO role (no template in this industry's catalog fits the requested work types) - the honest refusal, never a silent empty success (widen the work-type selection or select roles explicitly)`,
                                                items: [...workTypes],
                                        },
                                };
                        }
                        // The catalog's own order (never the affinity order, never the request order):
                        // the composed roles are the catalog templates the contributors named.
                        const roles: HarnessRole[] = [];
                        const provenance: { roleKey: string; contributedBy: readonly HarnessWorkType[] }[] = [];
                        for (const template of catalog) {
                                const contributedBy = contributors.get(template.roleKey);
                                if (contributedBy === undefined) {
                                        continue;
                                }
                                roles.push({ roleKey: template.roleKey, summary: template.summary });
                                provenance.push({ roleKey: template.roleKey, contributedBy: [...contributedBy] });
                        }
                        const clockRead = readClock('suggestComposition');
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const record: RoleCompositionRecord = {
                                contractVersion: ROLES_CONTRACTS_VERSION,
                                industry,
                                workTypes: [...workTypes],
                                composedAtIso: clockRead.at,
                                roles,
                                provenance,
                        };
                        return { ok: true, composition: JSON.parse(serializeRoleComposition(record)) as RoleCompositionRecord };
                },
                async validateSelection(request: unknown): Promise<RolesSelectionOutcome> {
                        const disposedRefusal = refuseIfDisposed('validateSelection');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const verdict = validateRoleSelection(request);
                        if (!verdict.ok) {
                                return { ok: false, refusal: { ...verdict.refusal } };
                        }
                        return { ok: true, selection: verdict.value };
                },
                async inspectCatalog(industry: unknown): Promise<RolesCatalogOutcome> {
                        const disposedRefusal = refuseIfDisposed('inspectCatalog');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        if (!isHarnessIndustry(industry)) {
                                return {
                                        ok: false,
                                        refusal: {
                                                reason: 'unknown-industry',
                                                law: 'THE FROZEN-VOCABULARY LAW',
                                                message: 'inspectCatalog: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility)',
                                                items: [showIndustry(industry)],
                                        },
                                };
                        }
                        // THE READ SURFACE: the frozen catalog BY REFERENCE, never a copy.
                        const member = industry as HarnessIndustry;
                        return { ok: true, industry: member, templates: INDUSTRY_ROLE_CATALOGS[member] };
                },
                dispose(): void {
                        disposed = true;
                },
        };
}

// --- the kit internals ---

interface BoundOptions {
        readonly clock: () => string;
}

function validateKitOptions(options: RolesKitOptions): BoundOptions {
        if (!isRecord(options)) {
                throw new TypeError('createRolesKit: options must be an object');
        }
        const opts = options as Record<string, unknown>;
        if (typeof opts.clock !== 'function') {
                throw new TypeError(
                        'createRolesKit: options.clock must be a function returning ISO string values (the injected-clock law - the kit never reads a clock itself)',
                );
        }
        const clock = opts.clock as () => string;
        const firstClock = clock();
        if (typeof firstClock !== 'string' || firstClock.length === 0) {
                throw new TypeError('createRolesKit: options.clock() must return a non-empty ISO string (the injected-clock law)');
        }
        return { clock };
}

/** Pure predicate: a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shows an industry value for the typed refusal items (the showValue discipline, primitives only). */
function showIndustry(value: unknown): string {
        if (typeof value === 'string') {
                return value.length === 0 ? '<empty string>' : value;
        }
        if (value === null) {
                return '<null>';
        }
        if (value === undefined) {
                return '<undefined>';
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
                return String(value);
        }
        if (Array.isArray(value)) {
                return '<array>';
        }
        return '<object>';
}
