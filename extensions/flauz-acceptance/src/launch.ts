/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The launch-act core (A-PROD-006-W2, DL-87 law 2): the
 * `flauz.acceptance.launch` semantics -- the FAIL-CLOSED minting of a
 * release-acceptance record over a GREEN, FRESH flauz.release.checklist
 * artifact.
 *
 * THE LAUNCH-ACT LAW (fail-closed): the record is minted ONLY over a GREEN,
 * FRESH checklist artifact. The typed refusals, never silent greens:
 *   - ABSENT  -- `.flauz/release/` carries no checklist artifact at all
 *                (nothing has passed the beta gate in this workspace);
 *   - TORN    -- the newest artifact does not parse as the
 *                flauz.release-checklist/v1 shape (an interrupted or
 *                hand-mangled gate run -- refuse, route to the operator);
 *   - RED     -- the newest artifact's verdict is NO-GO (the beta gate
 *                failed -- the launch act is the acceptance of a GO, never
 *                of a NO-GO);
 *   - STALE   -- the operator named an explicit checklist path that is not
 *                the NEWEST one (the freshness law: a newer checklist
 *                supersedes the release identity; re-launch over the newest
 *                after re-reading it);
 *   - NOT FOUND -- the operator named a path that is not among the
 *                enumerated checklist artifacts.
 *
 * THE GATE BINDING (DL-87 law 4): the launch binds the gate by READING the
 * checklist artifact's verdict field -- never by redefining it. The eleven
 * prove-items of the production gate stay verbatim in their owning plane
 * (pinned read-only by the contract suite); this plane consumes the
 * checklist's ten rows + its GO/NO-GO verdict exactly as written.
 *
 * THE RECORD CARRIES (the order's law, verbatim): the acceptance id
 * `flauz:acc:<16-hex>` (from an EXPLICIT rng/seed input -- the determinism
 * law), the bound checklist artifact path VERBATIM + its checklistId (the
 * release identity the incidents loop carries), the pinned product state
 * (the version-inventory + census snapshot shapes, contract-pinned from
 * flauz-release), and the NAMED OWNING CHECKS set (the checklist row kinds
 * + the incident's named regression test when launched to close an incident
 * loop).
 *
 * THE INCIDENT BINDING (the closing-loop link): when the launch names an
 * incident, the binding is resolved against the incidents ledger through the
 * contract-pinned reader -- a binding that cannot resolve (the ledger is
 * absent, or the incident is unknown) is a TYPED DISCLOSURE carried on the
 * record, never a fabricated link and never a dropped binding (the W1
 * unresolvable-binding law, mirrored).
 *
 * THE UNIQUE-ID LAW: re-launching an acceptance id appends a NEW revision
 * to the existing record, never duplicates (the append-only ledger law; the
 * re-launch re-binds to whatever the freshness law then allows -- usually a
 * newer checklist).
 */

import {
        type AcceptanceFsPort,
        type Clock,
        type AcceptanceLedger,
        type AcceptanceRecord,
        type AcceptanceRevision,
        type IncidentBinding,
        type NamedOwningCheck,
        type ReleaseChecklistArtifact,
        AcceptanceError,
        ACCEPTANCE_DIR,
        ACCEPTANCE_FILENAME,
        ACCEPTANCE_SCHEMA_ID,
        CHECKLIST_PREFIX,
        EXTENSION_ID,
        INCIDENTS_LEDGER_PATH,
        INCIDENTS_SCHEMA_ID,
        RELEASE_DIR,
        STAMP_SHAPE,
        isIncidentId,
        isPlainObject,
        isUnderFlauz,
        joinPath,
        parseChecklistArtifact,
        readAcceptanceLedger,
        serializeArtifact,
        checklistIdOf,
        acceptanceIdFromSeed,
} from './api.ts';
import { readProductState } from './productState.ts';
import { bankRecord, type BankingOutcome } from './ledger.ts';
import { sweepArtifact } from './privacy.ts';
import { toIsoStamp } from './format.ts';

// ---------------------------------------------------------------------------
// The checklist enumeration (the launch-act's subject discovery)
// ---------------------------------------------------------------------------

/** One enumerated checklist artifact: its workspace-relative path + stamp. */
export interface ChecklistCandidate {
        readonly relPath: string;
        readonly stamp: string;
}

/**
 * Enumerates every checklist artifact under `.flauz/release/` (the
 * `checklist-<stamp>.json` naming convention; the stamp shape enforced --
 * stray files are not checklist candidates). Sorted by stamp: the LAST entry
 * is the NEWEST (the stamp is the ISO epoch with colons removed, so
 * lexicographic order IS chronological order).
 */
export async function enumerateChecklistArtifacts(root: string, fs: AcceptanceFsPort): Promise<readonly ChecklistCandidate[]> {
        const entries = await fs.readdir(joinPath(root, RELEASE_DIR));
        if (entries === undefined) {
                return [];
        }
        const candidates: ChecklistCandidate[] = [];
        for (const name of [...entries].sort()) {
                if (!name.startsWith(CHECKLIST_PREFIX) || !name.endsWith('.json')) {
                        continue;
                }
                const stamp = name.slice(CHECKLIST_PREFIX.length, -'.json'.length);
                if (!STAMP_SHAPE.test(stamp)) {
                        continue;
                }
                candidates.push({ relPath: joinPath(RELEASE_DIR, name), stamp });
        }
        return candidates;
}

/**
 * Reads + parses ONE checklist artifact through the contract-pinned parser.
 * The outcome is typed: absent / torn / resolved (never a guessed shape).
 */
export async function readChecklistArtifact(root: string, fs: AcceptanceFsPort, relPath: string): Promise<{ readonly state: 'absent' } | { readonly state: 'torn'; readonly reason: string } | { readonly state: 'resolved'; readonly artifact: ReleaseChecklistArtifact; readonly text: string }> {
        if (!isUnderFlauz(relPath)) {
                return { state: 'torn', reason: `the checklist path '${relPath}' is not a workspace-relative path under .flauz/` };
        }
        const text = await fs.readFileUtf8(joinPath(root, relPath));
        if (text === undefined) {
                return { state: 'absent' };
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch (err) {
                return { state: 'torn', reason: `the checklist artifact does not parse as JSON: ${(err as Error).message}` };
        }
        const artifact = parseChecklistArtifact(parsed);
        if (artifact === undefined) {
                return { state: 'torn', reason: 'the checklist artifact is not the flauz.release-checklist/v1 shape (the contract-pinned parser refused it)' };
        }
        // the id re-derivation law: the artifact's checklistId must re-derive over its own body
        const { checklistId, ...body } = artifact;
        if (checklistIdOf(body) !== checklistId) {
                return { state: 'torn', reason: 'the checklist artifact\'s checklistId does not re-derive over its own bytes (the gate identity is torn)' };
        }
        return { state: 'resolved', artifact, text };
}

// ---------------------------------------------------------------------------
// The incident-binding resolution (the closing-loop link; typed disclosure)
// ---------------------------------------------------------------------------

/**
 * Resolves the launch's incident binding against the incidents ledger (the
 * contract-pinned reader; READ-ONLY -- this plane never writes incidents
 * state). The incidents ledger shape is contract-duplicated: `$schema`
 * 'flauz.incidents/v1' + an incidents[] of records carrying the
 * `flauz:inc:<16-hex>` ids. A binding that cannot resolve (the ledger is
 * absent/torn, or the incident id is unknown) is a TYPED DISCLOSURE --
 * resolved: false -- never a fabricated link (the W1 law, mirrored).
 */
export async function resolveIncidentBinding(root: string, fs: AcceptanceFsPort, incidentId: string): Promise<boolean> {
        const text = await fs.readFileUtf8(joinPath(root, INCIDENTS_LEDGER_PATH));
        if (text === undefined) {
                return false;
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch {
                return false; // a torn ledger cannot resolve a binding -- the typed disclosure
        }
        if (!isPlainObject(parsed) || parsed.$schema !== INCIDENTS_SCHEMA_ID || !Array.isArray(parsed.incidents)) {
                return false;
        }
        return parsed.incidents.some((row: unknown) => isPlainObject(row) && isIncidentId(row.incidentId) && row.incidentId === incidentId);
}

// ---------------------------------------------------------------------------
// The launch arguments + result
// ---------------------------------------------------------------------------

/** The launch command's typed arguments (commands carry DATA only). */
export interface LaunchArgs {
        /** The acceptance id seed (the explicit rng/seed input; the id is the first 16 hex chars of sha256(seed)). */
        readonly seed: string;
        readonly actor: string;
        /** Optional explicit checklist binding (workspace-relative under .flauz/release/); default: the NEWEST artifact. */
        readonly checklistPath?: string;
        /** Present when launched to close an incident loop. */
        readonly incident?: {
                readonly incidentId: string;
                readonly regressionTestId: string;
                /** Optional workspace-relative receipt ref under .flauz/ (the regression receipt's banked artifact). */
                readonly regressionReceiptRef?: string;
        };
}

/** Parses + validates the launch arguments (the typed refusal surface). */
export function parseLaunchArgs(arg: unknown): LaunchArgs {
        if (!arg || typeof arg !== 'object' || Array.isArray(arg)) {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.launch: the argument must be { seed, actor, checklistPath?, incident? }');
        }
        const record = arg as Record<string, unknown>;
        if (typeof record.seed !== 'string' || record.seed.length === 0) {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.launch: seed must be a non-empty string (the explicit rng/seed input -- the acceptance id is the first 16 hex chars of sha256(seed))');
        }
        if (typeof record.actor !== 'string' || record.actor.length === 0) {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.launch: actor must be a non-empty string (the operator id firing the launch; never contents)');
        }
        if (record.checklistPath !== undefined && (typeof record.checklistPath !== 'string' || record.checklistPath.length === 0)) {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.launch: checklistPath, when present, must be a non-empty workspace-relative string (the explicit checklist binding)');
        }
        let incident: LaunchArgs['incident'];
        if (record.incident !== undefined) {
                if (!record.incident || typeof record.incident !== 'object' || Array.isArray(record.incident)) {
                        throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.launch: incident, when present, must be { incidentId, regressionTestId, regressionReceiptRef? }');
                }
                const binding = record.incident as Record<string, unknown>;
                if (!isIncidentId(binding.incidentId)) {
                        throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.launch: incident.incidentId must match the flauz:inc:<16-hex> shape (the incident whose loop this launch closes)');
                }
                if (typeof binding.regressionTestId !== 'string' || binding.regressionTestId.length === 0) {
                        throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.launch: incident.regressionTestId must be a non-empty string (the incident\'s named regression test -- the launch carries it in the owning checks set)');
                }
                if (binding.regressionReceiptRef !== undefined && (typeof binding.regressionReceiptRef !== 'string' || !isUnderFlauz(binding.regressionReceiptRef))) {
                        throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.launch: incident.regressionReceiptRef, when present, must be a workspace-relative path under .flauz/ only (never absolute, never parent-escape, never contents)');
                }
                incident = {
                        incidentId: binding.incidentId,
                        regressionTestId: binding.regressionTestId,
                        ...(binding.regressionReceiptRef !== undefined ? { regressionReceiptRef: binding.regressionReceiptRef as string } : {}),
                };
        }
        return {
                seed: record.seed,
                actor: record.actor,
                ...(record.checklistPath !== undefined ? { checklistPath: record.checklistPath as string } : {}),
                ...(incident !== undefined ? { incident } : {}),
        };
}

/** The launch outcome (command-level). */
export interface LaunchResult {
        readonly ok: true;
        readonly acceptanceId: string;
        /** True when the id already existed and a NEW revision was appended (the unique-id law). */
        readonly revised: boolean;
        readonly revision: number;
        readonly acceptanceCount: number;
        readonly checklistPath: string;
        readonly checklistId: string;
        readonly verdict: 'GO';
        readonly owningCheckCount: number;
        readonly incidentBindingState: 'resolved' | 'disclosed-unresolvable' | 'none';
        readonly persisted: PersistedLaunch;
}

/** The persisted outcome. */
export interface PersistedLaunch {
        readonly ledgerPath: string;
        readonly revision: AcceptanceRevision;
        readonly banking: BankingOutcome;
}

/** The acceptance ledger's workspace-relative path. */
export const ACCEPTANCE_LEDGER_PATH = joinPath(ACCEPTANCE_DIR, ACCEPTANCE_FILENAME);

// ---------------------------------------------------------------------------
// The launch act (fail-closed)
// ---------------------------------------------------------------------------

/**
 * Mints the release-acceptance record over a GREEN, FRESH checklist
 * artifact. THE LAUNCH-ACT LAW: absent/torn/red/stale = typed REFUSAL,
 * never a silent green; the record is minted ONLY over the newest GO.
 */
export async function launchAcceptance(deps: { root: string; fs: AcceptanceFsPort; clock: Clock }, args: LaunchArgs): Promise<LaunchResult> {
        // --- the freshness law's subject: the enumerated checklist artifacts ---
        const candidates = await enumerateChecklistArtifacts(deps.root, deps.fs);
        if (candidates.length === 0) {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_NO_CHECKLIST', `flauz.acceptance.launch: REFUSED -- ${RELEASE_DIR} carries no checklist artifact (the launch act mints a release-acceptance record ONLY over a GREEN, FRESH flauz.release.checklist artifact; run flauz.release.checklist first -- the beta gate's go/no-go)`);
        }
        const newest = candidates[candidates.length - 1] as ChecklistCandidate;

        let boundPath: string;
        if (args.checklistPath !== undefined) {
                const found = candidates.find(candidate => candidate.relPath === args.checklistPath);
                if (found === undefined) {
                        throw new AcceptanceError('FLAUZ_ACCEPTANCE_CHECKLIST_NOT_FOUND', `flauz.acceptance.launch: REFUSED -- '${args.checklistPath}' is not among the enumerated checklist artifacts under ${RELEASE_DIR} (the enumerated set: ${candidates.map(candidate => candidate.relPath).join(', ')})`);
                }
                if (found.relPath !== newest.relPath) {
                        throw new AcceptanceError('FLAUZ_ACCEPTANCE_CHECKLIST_STALE', `flauz.acceptance.launch: REFUSED -- '${found.relPath}' is not the FRESH checklist (the newest is '${newest.relPath}'; a newer checklist supersedes the release identity -- re-launch over the newest after re-reading it)`);
                }
                boundPath = found.relPath;
        } else {
                boundPath = newest.relPath;
        }

        // --- the contract-pinned read (torn = typed refusal) ---
        const state = await readChecklistArtifact(deps.root, deps.fs, boundPath);
        if (state.state === 'absent') {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_NO_CHECKLIST', `flauz.acceptance.launch: REFUSED -- the bound checklist artifact '${boundPath}' is absent (it was enumerated but no longer reads back; re-run flauz.release.checklist)`);
        }
        if (state.state === 'torn') {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_CHECKLIST_TORN', `flauz.acceptance.launch: REFUSED -- the newest checklist artifact '${boundPath}' is TORN (${state.reason}); a torn gate run is never silently green -- route to the operator`);
        }
        const artifact = state.artifact;

        // --- the GREEN law (red = typed refusal; never a silent green) ---
        if (artifact.verdict !== 'GO') {
                const failing = artifact.rows.filter(row => row.verdict !== 'green').map(row => `${row.id} (${row.verdict})`);
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_CHECKLIST_RED', `flauz.acceptance.launch: REFUSED -- the newest checklist artifact '${boundPath}' is RED (verdict NO-GO; the failing row(s): ${failing.join(', ')}); the launch act is the acceptance of a GO, never of a NO-GO`);
        }

        // --- the pinned product state (the version-inventory + census snapshot) ---
        const pinnedState = await readProductState(deps.root, deps.fs);

        // --- the named owning checks set (the release's acceptance set) ---
        const owningChecks: NamedOwningCheck[] = artifact.rows.map(row => ({
                checkId: row.id,
                source: 'checklist-row' as const,
                owningSurface: row.evidence.command,
                // the ONE checklist row the acceptance plane can itself evaluate: the artifact row
                // (its own observable is the re-read + the checklistId re-derivation -- exactly
                // what flauz.acceptance.verify re-runs over the bound artifact)
                selfEvaluable: row.id === 'checklistArtifact',
        }));
        let incidentBinding: IncidentBinding | undefined;
        let incidentBindingState: LaunchResult['incidentBindingState'] = 'none';
        if (args.incident !== undefined) {
                const resolved = await resolveIncidentBinding(deps.root, deps.fs, args.incident.incidentId);
                incidentBinding = {
                        incidentId: args.incident.incidentId,
                        regressionTestId: args.incident.regressionTestId,
                        ...(args.incident.regressionReceiptRef !== undefined ? { regressionReceiptRef: args.incident.regressionReceiptRef } : {}),
                        resolved,
                        disclosed: resolved ? 'resolved' : 'disclosed-unresolvable',
                };
                incidentBindingState = resolved ? 'resolved' : 'disclosed-unresolvable';
                owningChecks.push({
                        checkId: args.incident.regressionTestId,
                        source: 'regression-test',
                        owningSurface: 'the repo test lane (the named regression test)',
                        selfEvaluable: false,
                });
        }

        // --- the revision (the record's newest shape) ---
        const at = deps.clock();
        const acceptanceId = acceptanceIdFromSeed(args.seed);

        // --- the ledger read + the unique-id law (append a NEW revision, never duplicate) ---
        const ledgerState = await readAcceptanceLedger(deps.root, deps.fs);
        if (ledgerState.state === 'torn') {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_FORMAT', `flauz.acceptance.launch: REFUSED -- the acceptance ledger is torn (${ledgerState.reason}); a launch would silently erase the torn evidence -- route to the operator`);
        }
        const existing = ledgerState.state === 'resolved' ? ledgerState.record.acceptances.find(record => record.acceptanceId === acceptanceId) : undefined;
        const revised = existing !== undefined;
        const revisionNumber = revised ? existing.revisions.length + 1 : 1;
        const revision: AcceptanceRevision = {
                revision: revisionNumber,
                launchedAtEpoch: at,
                launchedAtIso: toIsoStamp(at),
                actor: args.actor,
                checklistPath: boundPath,
                checklistId: artifact.checklistId,
                checklistVerdict: 'GO',
                productName: artifact.productName,
                productVersion: artifact.productVersion,
                pinnedState,
                owningChecks,
                ...(incidentBinding !== undefined ? { incidentBinding } : {}),
        };

        const record: AcceptanceRecord = revised
                ? { ...existing, revisions: [...existing.revisions, revision] }
                : { acceptanceId, firstLaunchedAtIso: toIsoStamp(at), firstLaunchedAtEpoch: at, revisions: [revision] };

        // --- the ledger write (swept fail-closed + banked census-visible) ---
        const persisted = await persistLaunch(deps, ledgerState, record, revised);

        return {
                ok: true,
                acceptanceId,
                revised,
                revision: revisionNumber,
                acceptanceCount: revised
                        ? (ledgerState.state === 'resolved' ? ledgerState.record.acceptances.length : 1)
                        : ((ledgerState.state === 'resolved' ? ledgerState.record.acceptances.length : 0) + 1),
                checklistPath: boundPath,
                checklistId: artifact.checklistId,
                verdict: 'GO',
                owningCheckCount: owningChecks.length,
                incidentBindingState,
                persisted,
        };
}

/** Persists the acceptance ledger the W1 way: swept, written, banked census-visible. */
async function persistLaunch(deps: { root: string; fs: AcceptanceFsPort; clock: Clock }, ledgerState: { readonly state: 'absent' } | { readonly state: 'resolved'; readonly record: AcceptanceLedger }, record: AcceptanceRecord, revised: boolean): Promise<PersistedLaunch> {
        const at = deps.clock();
        const previous = ledgerState.state === 'resolved' ? ledgerState.record : undefined;
        const acceptances = revised
                ? (previous?.acceptances ?? []).map(row => row.acceptanceId === record.acceptanceId ? record : row)
                : [...(previous?.acceptances ?? []), record];
        const ledger: AcceptanceLedger = {
                $schema: ACCEPTANCE_SCHEMA_ID,
                schemaVersion: 0,
                kind: 'flauz-acceptance',
                createdAt: previous !== undefined ? previous.createdAt : at,
                updatedAt: at,
                extensionId: EXTENSION_ID,
                acceptances,
        };
        sweepArtifact(ledger, 'acceptance-ledger');
        const ledgerLine = serializeArtifact(ledger);
        const ledgerRelPath = ACCEPTANCE_LEDGER_PATH;
        await deps.fs.mkdir(joinPath(deps.root, ACCEPTANCE_DIR));
        await deps.fs.writeFile(joinPath(deps.root, ledgerRelPath), ledgerLine);
        const revision = record.revisions[record.revisions.length - 1] as AcceptanceRevision;
        const banking = await bankRecord(deps, ledger, ledgerLine, ledgerRelPath);
        return { ledgerPath: joinPath(deps.root, ledgerRelPath), revision, banking };
}

/** Renders the launch outcome (the disclosure-first law). */
export function renderLaunch(result: LaunchResult): string[] {
        const lines: string[] = [];
        lines.push(`  acceptance: ${result.acceptanceId}`);
        lines.push(`    launch act: ${result.revised ? `revision ${String(result.revision)} appended (the unique-id law: re-launching an id appends a NEW revision, never duplicates)` : 'the first launch of this id'}`);
        lines.push(`    bound checklist: ${result.checklistPath} (checklistId ${result.checklistId.slice(0, 12)}..., verdict ${result.verdict} -- the release identity the incidents loop carries, VERBATIM)`);
        lines.push(`    named owning checks: ${String(result.owningCheckCount)} (the checklist row kinds${result.incidentBindingState !== 'none' ? ' + the incident\'s named regression test' : ''}; the self-evaluable subset is re-run by flauz.acceptance.verify, the rest are TYPED DISCLOSURE rows naming their owning surface)`);
        if (result.incidentBindingState !== 'none') {
                lines.push(`    incident binding: ${result.incidentBindingState}${result.incidentBindingState === 'disclosed-unresolvable' ? ' (the incidents ledger did not resolve the binding -- carried as a TYPED DISCLOSURE, never a fabricated link)' : ''}`);
        }
        lines.push(`    pinned product state: the version-inventory + census snapshot shapes (contract-pinned from flauz-release) -- ${String(result.persisted.revision.pinnedState.versionInventory.length)} surface(s) enumerated`);
        lines.push(`    ledger: ${result.persisted.ledgerPath} (append-only, census-visible: the banked evidence row taskId 'flauz-acceptance'${result.persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
        return lines;
}
