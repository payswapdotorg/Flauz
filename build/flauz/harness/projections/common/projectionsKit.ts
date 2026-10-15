/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-010 projections kit: the deterministic derivation runtime over
 * the projections contract vocabulary. THE ZERO-SEAM LAW (binding,
 * this family's design): projections are PURE DERIVATION over
 * caller-supplied composed records - the kit needs NO clock, NO rng
 * and NO fs port, and it accepts NONE. The construction options
 * object is the EMPTY record: any injected seam key (clock / rng /
 * fsPort / root / anything else) is a factory TypeError, because a
 * projection that read a clock, minted an id or touched a file
 * would stop being a projection (THE PROJECTION LAW). There is no
 * persistence of ANY kind here: no ledger, no envelope, no journal
 * (ARCHITECTURE-LOCK 12.6 - no second persistence authority; the
 * navigation model is a derived transport value, never a persisted
 * record).
 *
 * The kit surface: projectNavigation (THE PROJECTION FUNCTION,
 * delegating to the contract's frozen input walk - every typed
 * refusal carried complete), serializeNavigationModel /
 * parseNavigationModel (the canonical serialization laws, delegated),
 * listSections (the frozen section list read), and dispose (THE
 * DISPOSE LAW - the kit holds NO domain state, only the
 * surface-closed flag; after dispose, projectNavigation rejects with
 * the typed DISPOSED refusal, and serializeNavigationModel /
 * parseNavigationModel / listSections throw the TypeError naming the
 * DISPOSED law - the family's factory-misuse class, never a domain
 * refusal).
 *
 * LAWS (inherited binding from the contract module's header; the
 * contract module carries their enforcement surface): THE
 * PROJECTION LAW, THE IMPORT LAW, THE ANCHOR LAW, THE ABSENT-FAMILY
 * LAW, THE BINDING LAW, THE DUPLICATE-RECORD LAW, THE
 * SECTION-SOURCE MAP, THE SECTION-STATE LAW, THE CONTENT LAW, THE
 * DETERMINISM LAW (no Math.random, no Date.now, no new Date(...) and
 * no process.env in this module - law comments excepted; THE
 * ZERO-SEAM LAW above is the reason), THE FAIL-CLOSED LAW (factory
 * misuse throws TypeError; every domain refusal is a typed record),
 * THE SINGLE-VERSION LAW (the re-export chain: this family's version
 * plus the NINE landed family versions, all re-carried by
 * reference), THE CANONICAL SERIALIZATION LAW, THE DISPOSE LAW.
 */

import {
        DOMAIN_NAVIGATION_SECTIONS,
        PROJECTIONS_CONTRACTS_VERSION,
        PROJECTIONS_REJECTION_REASONS,
        parseNavigationModel,
        projectNavigation,
        serializeNavigationModel,
} from './projectionsContract.js';
import type {
        DomainNavigationModel,
        DomainNavigationSectionId,
        NavigationParseOutcome,
        NavigationProjectionOutcome,
        ProjectionsRejection,
} from './projectionsContract.js';

/** THE SINGLE-VERSION LAW: the kit re-carries the contract's version (declared ONCE there). */
export { PROJECTIONS_CONTRACTS_VERSION } from './projectionsContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the NINE landed family versions, re-carried by reference. */
export { DOMAIN_HARNESS_CONTRACTS_VERSION } from '../../contract/common/domainHarnessContract.js';
export { ONBOARDING_CONTRACTS_VERSION } from '../../onboarding/common/onboardingContract.js';
export { ROLES_CONTRACTS_VERSION } from '../../roles/common/rolesContract.js';
export { ONTOLOGY_CONTRACTS_VERSION } from '../../ontology/common/ontologyContract.js';
export { TEMPLATES_CONTRACTS_VERSION } from '../../templates/common/templatesContract.js';
export { BODIES_CONTRACTS_VERSION } from '../../bodies/common/bodiesContract.js';
export { PACKS_CONTRACTS_VERSION } from '../../packs/common/packsContract.js';
export { PROFILES_CONTRACTS_VERSION } from '../../profiles/common/profilesContract.js';
export { BENCHMARKS_CONTRACTS_VERSION } from '../../benchmarks/common/benchmarksContract.js';

/**
 * THE IMPORT LAW's surface re-export: the projection function, the
 * per-section row derivations, the model walk and the serialization
 * laws are the CONTRACT's own bindings (the same functions, never
 * re-implemented here).
 */
export {
        DOMAIN_NAVIGATION_SECTIONS,
        parseNavigationModel,
        projectNavigation,
        serializeNavigationModel,
} from './projectionsContract.js';
export type {
        DomainNavigationModel,
        DomainNavigationSection,
        DomainNavigationSectionId,
        DomainSectionRow,
        DomainSectionRowBadge,
        NavigationParseOutcome,
        NavigationProjectionOutcome,
        ProjectNavigationInputs,
        ProjectionsRejection,
        ProjectionsRejectionReason,
} from './projectionsContract.js';

/**
 * THE ZERO-SEAM LAW's options record: the EMPTY options object. A
 * projection kit accepts NO seams - no clock, no rng, no fs port, no
 * root, no injected vocabulary of any kind (the derivation is total
 * and deterministic over its inputs; the record vocabularies are the
 * imported real modules). Any key on the options object is the
 * factory TypeError below.
 */
export interface ProjectionsKitOptions {}

/**
 * The kit-layer refusal extras (the frozen list beyond the
 * contract's PROJECTIONS_REJECTION_REASONS):
 *   DISPOSED - THE DISPOSE LAW: the kit was disposed; every
 *              operation after dispose rejects (the kit holds NO
 *              domain state - dispose only closes the surface).
 */
export const PROJECTIONS_KIT_EXTRA_REFUSAL_REASONS = [
        'DISPOSED',
] as const;

/** The frozen kit refusal vocabulary: the contract's six projection reasons plus the kit-layer extras. */
export const PROJECTIONS_KIT_REFUSAL_REASONS = [
        ...PROJECTIONS_REJECTION_REASONS,
        ...PROJECTIONS_KIT_EXTRA_REFUSAL_REASONS,
] as const;
export type ProjectionsKitRefusalReason = (typeof PROJECTIONS_KIT_REFUSAL_REASONS)[number];

/** Pure predicate over the closed kit-refusal list. */
export function isProjectionsKitRefusalReason(value: unknown): value is ProjectionsKitRefusalReason {
        return (PROJECTIONS_KIT_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed kit refusal: the frozen reason, the violated law's name,
 * the deterministic detail sentence, and (for input-walk refusals)
 * the COMPLETE contract rejection table (never first-only).
 */
export interface ProjectionsKitRefusal {
        readonly reason: ProjectionsKitRefusalReason;
        readonly law: string;
        readonly detail: string;
        /** input-walk refusals carry the COMPLETE contract rejection table (never first-only). */
        readonly rejections?: readonly ProjectionsRejection[];
}

/** The kit projection outcome: ok carries the derived navigation model; failure carries the typed refusal. */
export type KitProjectionOutcome =
        | { readonly ok: true; readonly model: DomainNavigationModel }
        | { readonly ok: false; readonly refusal: ProjectionsKitRefusal };

/**
 * The deterministic projections kit (THE ZERO-SEAM LAW): every
 * operation is a pure delegate over the contract's own laws. The
 * kit holds NO domain state - the only mutable flag is the dispose
 * marker (THE DISPOSE LAW).
 */
export interface ProjectionsKit {
        projectNavigation(inputs: unknown): KitProjectionOutcome;
        serializeNavigationModel(model: unknown): string;
        parseNavigationModel(bytes: unknown): NavigationParseOutcome;
        listSections(): readonly DomainNavigationSectionId[];
        dispose(): void;
}

/**
 * Creates a projections kit (fail-closed factory). THE ZERO-SEAM
 * LAW: the options object, when present, must be the EMPTY record -
 * any key (a clock, an rng, an fs port, a root, anything else) is
 * the TypeError naming the seam and the law. The kit reads no
 * clock, mints no id and touches no file, ever.
 */
export function createProjectionsKit(options?: ProjectionsKitOptions): ProjectionsKit {
        if (options !== undefined) {
                if (typeof options !== 'object' || options === null || Array.isArray(options)) {
                        throw new TypeError('createProjectionsKit: options, when present, must be a plain object');
                }
                const keys = Object.keys(options as Record<string, unknown>);
                if (keys.length > 0) {
                        throw new TypeError(
                                `createProjectionsKit: the projections kit accepts NO seams (THE ZERO-SEAM LAW) - the option key(s) [${keys.join(', ')}] are refused; projections are pure derivation over caller-supplied composed records`,
                        );
                }
        }
        let disposed = false;
        const refuseIfDisposed = (op: string): ProjectionsKitRefusal | undefined => {
                if (disposed) {
                        return {
                                reason: 'DISPOSED',
                                law: 'THE DISPOSE LAW',
                                detail: `createProjectionsKit: the kit was disposed - the ${op} operation rejects (the kit holds NO domain state; dispose only closes the surface)`,
                        };
                }
                return undefined;
        };
        return {
                projectNavigation(inputs: unknown): KitProjectionOutcome {
                        const disposedRefusal = refuseIfDisposed('projectNavigation');
                        if (disposedRefusal) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const outcome: NavigationProjectionOutcome = projectNavigation(inputs);
                        if (outcome.ok) {
                                return { ok: true, model: outcome.model };
                        }
                        // The kit refusal's reason is the FIRST rejection's reason (the
                        // frozen walk order's first verdict - an honest label, never an
                        // umbrella), and the COMPLETE contract rejection table rides the
                        // refusal (never first-only).
                        return {
                                ok: false,
                                refusal: {
                                        reason: outcome.rejections[0].reason,
                                        law: outcome.rejections[0].law,
                                        detail: 'createProjectionsKit.projectNavigation: the input walk refused - the COMPLETE contract rejection table rides this refusal (never first-only)',
                                        rejections: outcome.rejections,
                                },
                        };
                },
                serializeNavigationModel(model: unknown): string {
                        // THE DISPOSE LAW's serialize leg: a pure serialization is still a
                        // kit-surface operation - a disposed kit refuses it (the surface is
                        // closed); the TypeError on a malformed model stays the contract's
                        // own fail-closed factory law, never swallowed.
                        const disposedRefusal = refuseIfDisposed('serializeNavigationModel');
                        if (disposedRefusal) {
                                throw new TypeError(`${disposedRefusal.law}: ${disposedRefusal.detail}`);
                        }
                        return serializeNavigationModel(model);
                },
                parseNavigationModel(bytes: unknown): NavigationParseOutcome {
                        // THE DISPOSE LAW's parse leg: a disposed kit is kit-surface
                        // misuse (the family's own class boundary - a factory-misuse
                        // TypeError, never a domain refusal), so the parse refuses
                        // with the TypeError naming the law; the contract's own parse
                        // refusals are never swallowed on a live kit.
                        const disposedRefusal = refuseIfDisposed('parseNavigationModel');
                        if (disposedRefusal) {
                                throw new TypeError(`${disposedRefusal.law}: ${disposedRefusal.detail}`);
                        }
                        return parseNavigationModel(bytes);
                },
                listSections(): readonly DomainNavigationSectionId[] {
                        const disposedRefusal = refuseIfDisposed('listSections');
                        if (disposedRefusal) {
                                throw new TypeError(`${disposedRefusal.law}: ${disposedRefusal.detail}`);
                        }
                        return DOMAIN_NAVIGATION_SECTIONS;
                },
                dispose(): void {
                        disposed = true;
                },
        };
}
