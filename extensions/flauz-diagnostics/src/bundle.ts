/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The support/debug bundle builder (A-PROD-004-W1): writes
 * `<workspace>/.flauz/support-bundle-<stamp>/` containing the enumerated
 * artifact classes:
 *
 *   MANIFEST.json       -- the enumerated artifact-class list (what the bundle
 *                          contains, class by class; the pre-creation
 *                          disclosure is rendered from the same source);
 *   diagnostics.json    -- the durable-state census (collectDiagnostics);
 *   provider-lanes.json -- the providers/policy/decision-ledger SUMMARY
 *                          (lane ids, model ids, decision counts by lane; NO
 *                          keys, NO credentials, NO endpoints);
 *   recent-events.json  -- the tail of the typed event surfaces (execution
 *                          journal + ops chain + provider switches), each row
 *                          projected by the privacy module's redaction laws;
 *   integrity.json      -- the tamper-evidence verdicts (collectIntegrity).
 *
 * Every artifact is swept for secret-shaped values BEFORE it is written
 * (fail-closed). The `contents` class is refused with the typed error naming
 * the future decision (the class laws live in api.ts/privacy.ts).
 */

import {
        type BundleClass,
        type Clock,
        type DiagFsPort,
        type EnvironmentInfo,
        type VersionsInfo,
        BUNDLE_CLASSES,
        BUNDLE_DIR_PREFIX,
        BUNDLE_SCHEMA_ID,
        CONTENTS_FUTURE_DECISIONS,
        DEFAULT_INCLUDE,
        DiagnosticsError,
        EVENT_TAIL_SIZE,
        FLAUZ_DIR,
        ORCH_JOURNAL_PATH,
        PROVIDER_LANES_SCHEMA_ID,
        PROVIDERS_PATH,
        PROVIDER_SWITCHES_PATH,
        RECENT_EVENTS_SCHEMA_ID,
        RESOURCES_OPS_PATH,
        ROUTING_DECISIONS_PATH,
        ROUTING_POLICY_PATH,
        REFUSED_CLASSES,
        isPlainObject,
        joinPath,
        serializeArtifact,
        sha256Hex,
        splitJsonl,
        utf8ByteLength,
} from './api.ts';
import { collectDiagnostics, type DiagnosticsSnapshot } from './census.ts';
import { redactJournalRow, redactOpsRecord, redactProviderSwitch, sweepArtifact } from './privacy.ts';
import { collectIntegrity, type IntegrityVerdicts, type OpsRecordShape, parseOpsLine } from './verify.ts';
import { toIsoStamp } from './format.ts';

// ---------------------------------------------------------------------------
// The provider-lanes summary (lane ids, model ids, decision counts by lane)
// ---------------------------------------------------------------------------

/** One provider lane: ids and enablement only -- NO baseUrl, NO credentialRef (the summary law). */
export interface LaneSummary {
        readonly providerId: string;
        readonly enabled: boolean | undefined;
        readonly modelIds: readonly string[];
}

/** The routing-policy summary: rule ids + ranking modes (ids and enums; descriptions dropped). */
export interface RoutingPolicySummary {
        readonly present: boolean;
        readonly ruleIds: readonly { readonly id: string; readonly ranking: unknown; readonly priority: unknown; readonly fallback: unknown }[];
}

/** The decision-ledger summary: total count + counts by selected lane. */
export interface DecisionSummary {
        readonly present: boolean;
        readonly count: number;
        readonly byLane: Readonly<Record<string, number>>;
}

/** The provider-lanes.json artifact body. */
export interface ProviderLanesSummary {
        readonly $schema: typeof PROVIDER_LANES_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly createdAt: number;
        readonly lanes: readonly LaneSummary[];
        readonly routingPolicy: RoutingPolicySummary;
        readonly decisions: DecisionSummary;
        readonly providerSwitchCount: number;
        readonly excludedByPrivacyLaw: readonly string[];
}

async function collectProviderLanes(root: string, fs: DiagFsPort, clock: Clock): Promise<ProviderLanesSummary> {
        // the providers file (the workspace lane overrides): lane ids + model ids + enabled only
        const providersText = await fs.readFileUtf8(joinPath(root, PROVIDERS_PATH));
        const lanes: LaneSummary[] = [];
        if (providersText !== undefined) {
                try {
                        const parsed: unknown = JSON.parse(providersText);
                        const overrides = isPlainObject(parsed) && Array.isArray(parsed.providers) ? parsed.providers : [];
                        for (const entry of overrides) {
                                if (!isPlainObject(entry) || typeof entry.providerId !== 'string') {
                                        continue;
                                }
                                const modelIds = Array.isArray(entry.models)
                                        ? entry.models.map(model => isPlainObject(model) && typeof model.modelId === 'string' ? model.modelId : undefined).filter((id): id is string => id !== undefined)
                                        : [];
                                lanes.push({ providerId: entry.providerId, enabled: typeof entry.enabled === 'boolean' ? entry.enabled : undefined, modelIds });
                        }
                } catch {
                        // an unparseable providers file is honest data: zero summarized lanes
                }
        }

        // the routing policy: rule ids + enums (descriptions are free-form -- dropped)
        const policyText = await fs.readFileUtf8(joinPath(root, ROUTING_POLICY_PATH));
        let routingPolicy: RoutingPolicySummary;
        if (policyText === undefined) {
                routingPolicy = { present: false, ruleIds: [] };
        } else {
                try {
                        const parsed: unknown = JSON.parse(policyText);
                        const rules = isPlainObject(parsed) && Array.isArray(parsed.rules) ? parsed.rules : [];
                        routingPolicy = {
                                present: true,
                                ruleIds: rules.map(rule => isPlainObject(rule) && typeof rule.id === 'string'
                                        ? { id: rule.id, ranking: rule.ranking, priority: rule.priority, fallback: rule.fallback }
                                        : { id: '', ranking: undefined, priority: undefined, fallback: undefined }),
                        };
                } catch {
                        routingPolicy = { present: true, ruleIds: [] };
                }
        }

        // the decision ledger: counts by selected lane (null selections count under 'unrouted')
        const decisionsText = await fs.readFileUtf8(joinPath(root, ROUTING_DECISIONS_PATH));
        let decisions: DecisionSummary;
        if (decisionsText === undefined) {
                decisions = { present: false, count: 0, byLane: {} };
        } else {
                const byLane: Record<string, number> = {};
                let count = 0;
                for (const line of splitJsonl(decisionsText)) {
                        if (line === '') {
                                continue;
                        }
                        try {
                                const parsed: unknown = JSON.parse(line);
                                if (!isPlainObject(parsed) || parsed.schema !== 'flauz.model-routing-decision/v0') {
                                        continue;
                                }
                                count += 1;
                                const selected = isPlainObject(parsed.selected) && typeof parsed.selected.providerId === 'string' ? parsed.selected.providerId : 'unrouted';
                                byLane[selected] = (byLane[selected] ?? 0) + 1;
                        } catch {
                                // a torn tail line is counted by integrity surfaces, not silently here
                        }
                }
                decisions = { present: true, count, byLane };
        }

        // the P2-FIX-116 linking events: count only (tails ride recent-events.json)
        const switchesText = await fs.readFileUtf8(joinPath(root, PROVIDER_SWITCHES_PATH));
        const providerSwitchCount = switchesText === undefined ? 0 : splitJsonl(switchesText).filter(line => line !== '').length;

        return {
                $schema: PROVIDER_LANES_SCHEMA_ID,
                schemaVersion: 0,
                createdAt: clock(),
                lanes,
                routingPolicy,
                decisions,
                providerSwitchCount,
                excludedByPrivacyLaw: ['providers.baseUrl', 'providers.credentialRef', 'rule descriptions', 'decision explanations', 'switch explanations'],
        };
}

// ---------------------------------------------------------------------------
// The recent-events tails (redacted per the class laws)
// ---------------------------------------------------------------------------

/** The recent-events.json artifact body. */
export interface RecentEvents {
        readonly $schema: typeof RECENT_EVENTS_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly createdAt: number;
        readonly tailSize: number;
        readonly executionJournal: {
                readonly present: boolean;
                readonly path: string;
                readonly totalRows: number;
                readonly tail: readonly unknown[];
        };
        readonly opsChain: {
                readonly present: boolean;
                readonly path: string;
                readonly totalRecords: number;
                readonly tail: readonly unknown[];
        };
        readonly providerSwitches: {
                readonly present: boolean;
                readonly path: string;
                readonly totalRows: number;
                readonly tail: readonly unknown[];
        };
}

async function collectRecentEvents(root: string, fs: DiagFsPort, clock: Clock): Promise<RecentEvents> {
        const tail = <T>(rows: readonly T[]): readonly T[] => rows.slice(-EVENT_TAIL_SIZE);

        // the execution journal (flauz-agent core): parse-free redaction (structure-checked per row)
        const journalText = await fs.readFileUtf8(joinPath(root, ORCH_JOURNAL_PATH));
        let executionJournal: RecentEvents['executionJournal'];
        if (journalText === undefined) {
                executionJournal = { present: false, path: ORCH_JOURNAL_PATH, totalRows: 0, tail: [] };
        } else {
                const parsed: unknown[] = [];
                for (const line of splitJsonl(journalText)) {
                        if (line === '') {
                                continue;
                        }
                        try {
                                parsed.push(JSON.parse(line));
                        } catch {
                                parsed.push({ unparsed: true });
                        }
                }
                executionJournal = {
                        present: true,
                        path: ORCH_JOURNAL_PATH,
                        totalRows: parsed.length,
                        tail: tail(parsed).map(row => redactJournalRow(row)),
                };
        }

        // the ops chain (flauz-resources): strict parse, then project
        const opsText = await fs.readFileUtf8(joinPath(root, RESOURCES_OPS_PATH));
        let opsChain: RecentEvents['opsChain'];
        if (opsText === undefined) {
                opsChain = { present: false, path: RESOURCES_OPS_PATH, totalRecords: 0, tail: [] };
        } else {
                const records: OpsRecordShape[] = [];
                for (const [index, line] of splitJsonl(opsText).entries()) {
                        if (line === '') {
                                continue;
                        }
                        const outcome = parseOpsLine(line, index + 1);
                        if (outcome.ok) {
                                records.push(outcome.row);
                        }
                }
                opsChain = {
                        present: true,
                        path: RESOURCES_OPS_PATH,
                        totalRecords: records.length,
                        tail: tail(records).map(record => redactOpsRecord(record)),
                };
        }

        // the provider switches (flauz-models, the P2-FIX-116 linking events)
        const switchesText = await fs.readFileUtf8(joinPath(root, PROVIDER_SWITCHES_PATH));
        let providerSwitches: RecentEvents['providerSwitches'];
        if (switchesText === undefined) {
                providerSwitches = { present: false, path: PROVIDER_SWITCHES_PATH, totalRows: 0, tail: [] };
        } else {
                const parsed: unknown[] = [];
                for (const line of splitJsonl(switchesText)) {
                        if (line === '') {
                                continue;
                        }
                        try {
                                parsed.push(JSON.parse(line));
                        } catch {
                                parsed.push({ unparsed: true });
                        }
                }
                providerSwitches = {
                        present: true,
                        path: PROVIDER_SWITCHES_PATH,
                        totalRows: parsed.length,
                        tail: tail(parsed).map(row => redactProviderSwitch(row)),
                };
        }

        return {
                $schema: RECENT_EVENTS_SCHEMA_ID,
                schemaVersion: 0,
                createdAt: clock(),
                tailSize: EVENT_TAIL_SIZE,
                executionJournal,
                opsChain,
                providerSwitches,
        };
}

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------

/** The per-class disclosure entries (the MANIFEST law source + the command surface's pre-creation render). */
export const ARTIFACT_CLASS_DISCLOSURE: readonly { readonly artifactClass: BundleClass; readonly file: string; readonly contains: string }[] = [
        { artifactClass: 'manifest', file: 'MANIFEST.json', contains: 'this enumeration itself: the artifact-class list, the include set, the per-class privacy posture, and the sha256+bytes of every other file in the bundle' },
        { artifactClass: 'diagnostics', file: 'diagnostics.json', contains: 'the product/extension versions, the environment summary (node/platform/arch), and the durable-state census of .flauz/ (task/event/status counts, ledger rows + chain-head hash + kind counts, resources graph ref/edge/surface counts, ops-chain length, environments registry count, browser-session journal count, workflow envelope count, orchestration graph/journal counts) -- COUNTS AND HASHES ONLY, never contents' },
        { artifactClass: 'provider-lanes', file: 'provider-lanes.json', contains: 'the provider lane ids + model ids + enablement, the routing-policy rule ids + ranking modes, the decision counts by selected lane, and the provider-switch event count -- NO keys, NO credentials, NO endpoints' },
        { artifactClass: 'recent-events', file: 'recent-events.json', contains: `the last ${String(EVENT_TAIL_SIZE)} rows of each typed event surface (the execution journal, the resources ops chain, the provider-switch linking events), each row reduced to ids, actors, enums, paths and digests -- free-form payloads, causes, notes and explanations are dropped (contents class)` },
        { artifactClass: 'integrity', file: 'integrity.json', contains: 'the tamper-evidence verdicts: the evidence-ledger chain recompute (seq contiguity, prev linkage, watermark comparison) and the resource ops-chain recompute (digest continuity, prev linkage, envelope head digest); checkpoint signatures are counted only (verified owner-side -- the user keystore never enters a bundle)' },
];

/** The refusals enumerated in every manifest (the v0 privacy law, stated up front). */
export const REFUSAL_DISCLOSURE: readonly { readonly artifactClass: string; readonly reason: string; readonly requiresFutureDecision: readonly string[] }[] = [
        { artifactClass: 'contents', reason: 'file CONTENTS are never included in a v0 support bundle', requiresFutureDecision: CONTENTS_FUTURE_DECISIONS },
];

/** One written bundle file's receipt. */
export interface BundleFileReceipt {
        readonly artifactClass: BundleClass;
        readonly file: string;
        readonly sha256: string;
        readonly bytes: number;
}

/** The createBundle result (surfaced by the command + tests). */
export interface SupportBundleResult {
        readonly bundleDir: string;
        readonly bundleDirName: string;
        readonly files: readonly BundleFileReceipt[];
        readonly createdAt: number;
}

/** Deps of the bundle builder. */
export interface BundleDeps {
        readonly root: string;
        readonly fs: DiagFsPort;
        readonly clock: Clock;
        readonly versions: VersionsInfo;
        readonly environment: EnvironmentInfo;
}

/**
 * The filename-safe stamp of a bundle directory: the toIsoStamp serialization
 * (format.ts -- the PU6 single timestamp source) with the path-hostile ':'
 * stripped (path sanitization, not date formatting; Windows forbids colons
 * in directory names).
 */
export function bundleStamp(epochMs: number): string {
        return toIsoStamp(epochMs).replaceAll(':', '');
}

/**
 * Validates + resolves an include list. Returns the resolved safe-set subset
 * or throws the typed refusals (contents -> FLAUZ_DIAG_CONTENTS_REFUSED with
 * the future-decision list; anything else off the safe set ->
 * FLAUZ_DIAG_UNKNOWN_CLASS naming the valid classes). Pure: no fs effects.
 */
export function resolveInclude(include: readonly string[] | undefined): readonly BundleClass[] {
        if (include !== undefined && include.length === 0) {
                throw new DiagnosticsError(
                        'FLAUZ_DIAG_UNKNOWN_CLASS',
                        `flauz.diagnostics/v0: the include list is empty -- an explicit empty selection is not the default (omit 'include' for the full safe set: ${DEFAULT_INCLUDE.join(', ')})`,
                );
        }
        const requested = include === undefined ? DEFAULT_INCLUDE : include;
        const resolved: BundleClass[] = [];
        for (const name of requested) {
                if ((REFUSED_CLASSES as readonly string[]).includes(name)) {
                        throw new DiagnosticsError(
                                'FLAUZ_DIAG_CONTENTS_REFUSED',
                                `flauz.diagnostics/v0: the '${name}' class is REFUSED in a v0 support bundle -- ${REFUSAL_DISCLOSURE[0]?.reason ?? ''}; a contents-class bundle would need a future decision: ${CONTENTS_FUTURE_DECISIONS.join('; ')}`,
                        );
                }
                if (!(BUNDLE_CLASSES as readonly string[]).includes(name)) {
                        throw new DiagnosticsError(
                                'FLAUZ_DIAG_UNKNOWN_CLASS',
                                `flauz.diagnostics/v0: unknown include class '${name}' (valid: ${BUNDLE_CLASSES.join(', ')}; refused: ${REFUSED_CLASSES.join(', ')})`,
                        );
                }
                if (!(resolved as string[]).includes(name)) {
                        resolved.push(name as BundleClass);
                }
        }
        return resolved;
}

/**
 * Creates the support bundle. The manifest class is always included (it is
 * the enumeration); the data classes are the resolved include set. Every
 * artifact is swept for secret-shaped values before any byte is written.
 */
export async function createSupportBundle(deps: BundleDeps, include?: readonly string[]): Promise<SupportBundleResult> {
        const resolved = resolveInclude(include);
        const createdAt = deps.clock();
        const dirName = `${BUNDLE_DIR_PREFIX}${bundleStamp(createdAt)}`;
        const bundleDir = joinPath(deps.root, FLAUZ_DIR, dirName);

        // --- collect the data artifacts (swept below, written only after every sweep passed) ---
        const diagnostics: DiagnosticsSnapshot | undefined = resolved.includes('diagnostics') ? await collectDiagnostics(deps) : undefined;
        const providerLanes = resolved.includes('provider-lanes') ? await collectProviderLanes(deps.root, deps.fs, deps.clock) : undefined;
        const recentEvents = resolved.includes('recent-events') ? await collectRecentEvents(deps.root, deps.fs, deps.clock) : undefined;
        const integrity: IntegrityVerdicts | undefined = resolved.includes('integrity') ? await collectIntegrity(deps.root, deps.fs) : undefined;

        // --- assemble the bodies + the fail-closed sweep over EVERY one of them ---
        const bodies = new Map<string, { readonly artifactClass: BundleClass; readonly body: unknown }>();
        if (diagnostics !== undefined) {
                sweepArtifact(diagnostics, 'diagnostics.json');
                bodies.set('diagnostics.json', { artifactClass: 'diagnostics', body: diagnostics });
        }
        if (providerLanes !== undefined) {
                sweepArtifact(providerLanes, 'provider-lanes.json');
                bodies.set('provider-lanes.json', { artifactClass: 'provider-lanes', body: providerLanes });
        }
        if (recentEvents !== undefined) {
                sweepArtifact(recentEvents, 'recent-events.json');
                bodies.set('recent-events.json', { artifactClass: 'recent-events', body: recentEvents });
        }
        if (integrity !== undefined) {
                sweepArtifact(integrity, 'integrity.json');
                bodies.set('integrity.json', { artifactClass: 'integrity', body: integrity });
        }

        // --- the manifest (enumeration first, receipts of the swept bodies after) ---
        const receipts: BundleFileReceipt[] = [];
        for (const [file, entry] of [...bodies.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
                const text = serializeArtifact(entry.body);
                receipts.push({ artifactClass: entry.artifactClass, file, sha256: sha256Hex(text), bytes: utf8ByteLength(text) });
        }
        const manifest = {
                $schema: BUNDLE_SCHEMA_ID,
                schemaVersion: 0,
                createdAt,
                productVersion: deps.versions.productVersion,
                productName: deps.versions.productName,
                bundleDirName: dirName,
                include: resolved,
                privacyLaw: 'REDACTS BY DEFAULT: counts and hashes only; paths and ids are metadata; file contents are never included in v0 (the contents class is refused with a typed error)',
                artifactClasses: ARTIFACT_CLASS_DISCLOSURE.filter(disclosure => disclosure.artifactClass === 'manifest' || resolved.includes(disclosure.artifactClass)),
                refusedClasses: REFUSAL_DISCLOSURE,
                files: receipts,
        };
        sweepArtifact(manifest, 'MANIFEST.json');

        // --- write (only now that everything swept clean) ---
        await deps.fs.mkdir(bundleDir);
        const written: BundleFileReceipt[] = [];
        for (const [file, entry] of [...bodies.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
                const text = serializeArtifact(entry.body);
                await deps.fs.writeFile(joinPath(bundleDir, file), text);
                written.push({ artifactClass: entry.artifactClass, file, sha256: sha256Hex(text), bytes: utf8ByteLength(text) });
        }
        const manifestText = serializeArtifact(manifest);
        await deps.fs.writeFile(joinPath(bundleDir, 'MANIFEST.json'), manifestText);
        written.push({ artifactClass: 'manifest', file: 'MANIFEST.json', sha256: sha256Hex(manifestText), bytes: utf8ByteLength(manifestText) });

        return { bundleDir, bundleDirName: dirName, files: written, createdAt };
}
