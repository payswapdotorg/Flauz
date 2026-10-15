/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * DH-010 Harness console port - the injected seam between the console
 * state machine (src/harnessState.ts) and the real Domain Harness OS
 * kits at build/flauz/harness/. The runtime binding lives in
 * src/flauzHarnessPort.ts (the ONLY cross-lane runtime edge; esbuild
 * resolves the kits' .js specifiers at bundle time). NO TEST EVER
 * IMPORTS THAT FILE - Node type stripping cannot resolve those .js
 * specifiers - so the test lane covers the console state machine and
 * the view rendering against THIS contract, while the binding is
 * exercised by the bundle + activation gates.
 *
 * THE IMPORT LAW (this surface's charter): the observed view-models
 * are DERIVED from the real kits' own records (the DH-02 session
 * record, the DH-01 harness record, the DH-03 roles session, the
 * DH-010 navigation model) - the record shapes and vocabularies are
 * imported types, never re-declared vocabularies. Every value the
 * console renders is OBSERVED from the real kits through this port;
 * the surface fabricates nothing.
 *
 * THE CLOSED ACTIVATION SEAM (ARCHITECTURE-LOCK 12.5/12.6): the
 * console SELECTS, INSPECTS and COMPOSES through the real kits, and
 * applying/activating a harness routes through the DH-01 authority -
 * never through this surface (the refusal rides every recorded
 * proposal, verbatim).
 */

import type { DomainNavigationModel } from '../../../build/flauz/harness/projections/common/projectionsContract.ts';

/** One workspace harness summary row (observed from the REAL DH-01 kit's listHarnesses). */
export interface HarnessSummaryRow {
        /** The harness id (the REAL flauz:hrn:<16-hex> form). */
        readonly harnessId: string;
        /** The REAL DH-01 lifecycle state (draft / proposed / approved / active / retired). */
        readonly state: string;
        /** The harness's industry (a REAL HARNESS_INDUSTRIES member). */
        readonly industry: string;
        /** The harness's display name. */
        readonly displayName: string;
}

/** The observed onboarding selection session (derived from the REAL DH-02 session record). */
export interface SelectionSessionView {
        /** The session id (the REAL flauz:onb:<16-hex> form). */
        readonly sessionId: string;
        /** The REAL DH-02 stage (industry / company / work-types / review / proposed). */
        readonly stage: string;
        /** The selected industry (undefined until selected). */
        readonly industry: string | undefined;
        /** The company display name (undefined until composed). */
        readonly companyDisplayName: string | undefined;
        /** The company size band (a REAL COMPANY_SIZE_BANDS member; undefined until composed). */
        readonly companySizeBand: string | undefined;
        /** The selected work types (empty until selected). */
        readonly workTypes: readonly string[];
        /** The review composition's role keys (the observed roles; empty until the draft composes). */
        readonly roleKeys: readonly string[];
        /** The proposed harness id (undefined until the session proposes). */
        readonly proposedHarnessId: string | undefined;
        /** The session's revision count (every applied op appends one). */
        readonly revision: number;
}

/** One composed DH-03 roles session the draft can compose from (observed from the REAL roles kit). */
export interface RoleCompositionOption {
        /** The roles session id (the REAL flauz:rol:<16-hex> form). */
        readonly sessionId: string;
        /** The industry the composition is scoped to. */
        readonly industry: string;
        /** The composed roles' keys (the observed roleKeys, in composition order). */
        readonly roleKeys: readonly string[];
}

/** One recorded proposal (the proposed-draft state; reversible, in-session; the refusal rides verbatim). */
export interface ProposedDraft {
        /** `prop-` + 8 lowercase hex chars, deterministic in the proposal inputs. */
        readonly proposalId: string;
        /** The session that proposed. */
        readonly sessionId: string;
        /** The harness the real DH-02 walk minted (through the inner REAL DH-01 kit). */
        readonly harnessId: string;
        /** ISO string, injected at the proposal call. */
        readonly proposedAt: string;
        /** The activation refusal, carried verbatim on every recorded proposal. */
        readonly refusalReason: string;
}

/** The typed session-op result: ok carries the observed session; refusal carries the observed kit refusal. */
export type SessionOpResult =
        | { readonly ok: true; readonly session: SelectionSessionView }
        | { readonly ok: false; readonly reason: string; readonly detail: string };

/** The typed roles-compositions list result: ok carries the observed options; refusal carries the observed kit refusal. */
export type RoleCompositionsResult =
        | { readonly ok: true; readonly options: readonly RoleCompositionOption[] }
        | { readonly ok: false; readonly reason: string; readonly detail: string };

/** The typed harness list result: ok carries the observed summaries; refusal carries the observed kit refusal. */
export type HarnessListResult =
        | { readonly ok: true; readonly harnesses: readonly HarnessSummaryRow[] }
        | { readonly ok: false; readonly reason: string; readonly detail: string };

/** The typed navigation-load result: ok carries the REAL projected navigation model. */
export type NavigationLoadResult =
        | { readonly ok: true; readonly model: DomainNavigationModel }
        | { readonly ok: false; readonly reason: string; readonly detail: string };

/**
 * The port the Harness console extension consumes. Every operation is
 * an observed read or a real-kit composition step; the port mints
 * nothing itself (the id seams belong to the real kits), never reads
 * a clock (the caller injects the ISO stamps) and never executes
 * agent work.
 */
export interface HarnessConsolePort {
        /** Stable port identifier. */
        readonly id: string;
        /** Honesty label for the lane this port serves. */
        readonly mode: 'fixture' | 'flauz';
        /** The REAL frozen industry list (read from the DH-01 contract vocabulary). */
        listIndustries(): Promise<readonly string[]>;
        /** The REAL frozen company size-band list (read from the DH-02 contract vocabulary). */
        listSizeBands(): Promise<readonly string[]>;
        /** The REAL frozen work-type list (read from the DH-01 contract vocabulary). */
        listWorkTypes(): Promise<readonly string[]>;
        /** Begin an onboarding session (the REAL DH-02 begin op). */
        beginSession(): Promise<SessionOpResult>;
        /** Select the session's industry (the REAL DH-02 select-industry op). */
        selectIndustry(sessionId: string, industry: string): Promise<SessionOpResult>;
        /** Compose the session's company profile (the REAL DH-02 compose-company op). */
        composeCompany(sessionId: string, displayName: string, sizeBand: string): Promise<SessionOpResult>;
        /** Select the session's work types (the REAL DH-02 select-work-types op). */
        selectWorkTypes(sessionId: string, workTypes: readonly string[]): Promise<SessionOpResult>;
        /**
         * Compose the review draft from a composed DH-03 roles session and propose
         * the session (the REAL DH-03 emitReviewComposition -> the REAL DH-02
         * compose-draft + propose-session ops; the harness is minted by the inner
         * REAL DH-01 kit). The typed refusal carries the first refusing kit's
         * reason and detail verbatim.
         */
        proposeDraft(sessionId: string, rolesSessionId: string): Promise<SessionOpResult>;
        /** Inspect a session (the observed DH-02 session record as the console view-model). */
        inspectSession(sessionId: string): Promise<SessionOpResult>;
        /** List the workspace's composed DH-03 roles sessions (the observed options for the draft). */
        listRoleCompositions(): Promise<RoleCompositionsResult>;
        /** List the workspace's harnesses (observed from the REAL DH-01 ledger). */
        listHarnesses(): Promise<HarnessListResult>;
        /**
         * Load the anchor harness and its composed family records from the
         * workspace (the REAL family loaders) and derive the navigation model
         * (the REAL DH-010 projectNavigation). A missing harness or a refusing
         * loader is the typed observed refusal - never a silent partial model.
         */
        loadNavigation(harnessId: string): Promise<NavigationLoadResult>;
}

/** Re-exported view-model shape (the port's vocabulary IS the console's). */
export type { DomainNavigationModel };
