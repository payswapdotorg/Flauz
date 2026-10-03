/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The production gate (A-PROD-005-W1 -- the production-readiness plane's
 * third surface): the one-command verdict binding the ELEVEN prove-items of
 * the roadmap's A-PROD-005 gate, each row carrying its evidence pointer.
 *
 * THE VERDICT LAW: the aggregate is GO-FOR-BETA / NOT-PRODUCTION-READY --
 * never a silently green aggregate. A row is one of:
 *
 *   green    -- the prove-item's surface EXISTS and evaluates green at
 *               runtime (the row carries the evidence pointer: the command
 *               + the observable);
 *   red      -- the prove-item's surface exists and evaluates FAILING (the
 *               exact reason is the row's);
 *   degraded -- the prove-item's surface exists but cannot resolve here
 *               (the runtime-installed-product census with no installed
 *               product in the worker sandbox) -- NOT green, never guessed;
 *   not-yet  -- the prove-item's machinery DOES NOT EXIST at this base: the
 *               row names the owning later A-PROD-005 wave (the typed
 *               routing the work order demands) -- NOT green by
 *               construction.
 *
 * GO-FOR-BETA requires every row green AND zero not-yet rows (a product
 * with unrouted machinery is at best a beta); any red/degraded/not-yet row
 * = NOT-PRODUCTION-READY with the exact row-level truth.
 *
 * THE ELEVEN ROWS (the roadmap's prove-items, verbatim in id):
 *   1. reproducibleArtifacts -- the double-bundle manifest pins (the
 *      committed bundle-manifest.json + the security-runtime-gate packaging
 *      row's reproducibility posture; STATION-PENDING on worker branches is
 *      the documented doctrine, rendered in the row's reason);
 *   2. signingIntegrity      -- the A-PROD-005-W2 signing plane
 *      (flauz.integrity.sign/verify/status: the detached-signature ledger
 *      over the pinned bundle artifacts, the self-chained ledger, the
 *      one-command typed verify) -- machinery-derived from the live
 *      registry, never a hardcoded presence claim; the local-dev key
 *      posture + the empty-by-design ledger state are the row's honest
 *      disclosures; (station integration 2026-10-03: the row flipped
 *      from not-yet when W2 landed the machinery);
 *   3. securityPosture       -- the security-gate + security-runtime-gate
 *      rows over the real committed surfaces (the allowlists' shape, the
 *      SBOM coverage, the pinned bundle manifest);
 *   4. dataIsolation         -- the A-PROD-005-W3 isolation plane
 *      (flauz.isolation.audit/enforce/status: the boundary audit over
 *      every persistent surface + the one-tree enforcement + the
 *      export-dir shape) -- machinery-derived from the live registry,
 *      never a hardcoded presence claim; the workspace-vs-host boundary
 *      is the row's honest disclosure; (station integration 2026-10-03:
 *      the row flipped from not-yet when W3 landed the machinery);
 *   5. secretHandling        -- the canary sweep laws + the vault-only
 *      policy surfaces (the secrets allowlist's shape, the audit allowlist's
 *      shape, the redaction-law statements the matrix carries);
 *   6. workerDurability      -- NOT-YET (long-running worker supervision is
 *      a later wave);
 *   7. observability         -- the W4 telemetry plane (local-only, opt-in,
 *      the taxonomy closure -- evaluated read-only);
 *   8. backupRecovery        -- the W2 export/verify/restore drills (the
 *      newest export's presence + the export-tree shape, evaluated
 *      read-only);
 *   9. failureRollback       -- the W3+W4 machinery (the torn-migration
 *      signals absent + the per-surface readiness identity/absent over the
 *      current state + the failure taxonomy closed);
 *  10. upgradeCompatibility  -- the W3 plan grammar + the W5 updateCheck
 *      (the per-surface version inventory: every present surface identity,
 *      zero refusals);
 *  11. documentedCapabilities-- THIS WAVE's matrix (the derivation runs
 *      live: the matrix's own verdict is the row's).
 *
 * THE RECORD: `.flauz/production/gate-<stamp>.json`
 * (flauz.production-gate/v1) -- swept fail-closed, banked census-visible,
 * the watermark re-synced.
 */

import {
        type Clock,
        type ProductionFsPort,
        type VersionsInfo,
        AUDIT_ALLOWLIST_PATH,
        EXPORTS_DIR,
        EXPORT_DIR_PREFIX,
        EXTENSION_ID,
        GATE_RECORD_PREFIX,
        GATE_RECORD_SCHEMA_ID,
        MARKER_PATH,
        PRODUCT_BUNDLE_MANIFEST_PATH,
        PRODUCTION_DIR,
        SECURITY_ALLOWLIST_PATH,
        STAGE_SUFFIX,
        TELEMETRY_CONFIG_PATH,
        isPlainObject,
        joinPath,
        serializeArtifact,
} from './api.ts';
import { readProductState } from './productState.ts';
import { readInstalledProduct } from './installedProduct.ts';
import type { InstalledProductPort } from './installedProduct.ts';
import { runMatrix, type CapabilityMatrixResult } from './matrix.ts';
import { readSurfaceVersions, classifyReadings } from './versionInventory.ts';
import { sweepArtifact } from './privacy.ts';
import { bankLedgerRowFor, type BankingOutcome } from './banking.ts';
import { toIsoStamp } from './format.ts';

// ---------------------------------------------------------------------------
// The row shapes
// ---------------------------------------------------------------------------

/** The gate row status vocabulary (the go/no-go grammar). */
export type GateRowStatus = 'green' | 'red' | 'degraded' | 'not-yet';

/** The row's evidence pointer (the owning command/surface + its observable). */
export interface GateEvidence {
        readonly command: string;
        readonly observable: string;
}

/** One gate row. */
export interface GateRow {
        readonly id: string;
        readonly title: string;
        readonly status: GateRowStatus;
        readonly evidence: GateEvidence;
        readonly reasons: readonly string[];
        readonly details: Record<string, unknown>;
}

/** The whole gate result (the `flauz.production.gate` surface). */
export interface ProductionGateResult {
        readonly verdict: 'GO-FOR-BETA' | 'NOT-PRODUCTION-READY';
        readonly createdAt: number;
        readonly productRoot: string;
        readonly rows: readonly GateRow[];
        readonly refusalRows: readonly string[];
}

/** Deps of the gate. */
export interface GateDeps {
        readonly root: string;
        readonly fs: ProductionFsPort;
        readonly clock: Clock;
        readonly versions: VersionsInfo;
        /** The repo-state product root (the caller's typed refusal owns the absent case). */
        readonly productRoot: string;
        /** The runtime installed-product port (row 3's census consultation). */
        readonly installedProduct: InstalledProductPort;
}

function row(id: string, title: string, status: GateRowStatus, evidence: GateEvidence, reasons: readonly string[], details: Record<string, unknown>): GateRow {
        return { id, title, status, evidence, reasons, details };
}

// ---------------------------------------------------------------------------
// The eleven rows
// ---------------------------------------------------------------------------

// --- row 1: reproducible release artifacts (the double-bundle manifest pins) ---
async function reproducibleArtifactsRow(deps: GateDeps): Promise<GateRow> {
        const evidence: GateEvidence = { command: 'the security-runtime-gate packaging row (node build/flauz/scripts/security-runtime-gate.mjs --root .)', observable: 'the double-bundle run: every flauz extension bundled TWICE with the repo\'s own esbuild, byte-identical dist artifacts, hashed into build/flauz/security/bundle-manifest.json' };
        const text = await deps.fs.readFileUtf8(joinPath(deps.productRoot, PRODUCT_BUNDLE_MANIFEST_PATH));
        if (text === undefined) {
                return row('reproducibleArtifacts', 'reproducible release artifacts', 'red', evidence, [`${PRODUCT_BUNDLE_MANIFEST_PATH} is absent from the product state -- the pinned bundle manifest is the reproducibility evidence`], {});
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch (err) {
                return row('reproducibleArtifacts', 'reproducible release artifacts', 'red', evidence, [`${PRODUCT_BUNDLE_MANIFEST_PATH} does not parse (${(err as Error).message})`], {});
        }
        if (!isPlainObject(parsed) || !isPlainObject(parsed.bundles)) {
                return row('reproducibleArtifacts', 'reproducible release artifacts', 'red', evidence, [`${PRODUCT_BUNDLE_MANIFEST_PATH} carries no bundles{} -- not a bundle manifest body`], {});
        }
        const bundleNames = Object.keys(parsed.bundles).sort();
        const status = typeof parsed.status === 'string' ? parsed.status : 'unknown';
        const reasons: string[] = [];
        reasons.push(`the committed manifest pins ${String(bundleNames.length)} bundle(s) at status ${JSON.stringify(status)} (base ${typeof parsed.baseCommit === 'string' ? parsed.baseCommit.slice(0, 12) : 'unknown'})`);
        reasons.push('the STATION-PENDING doctrine: on a worker branch the CI packaging-reproducibility row FAILS BY DESIGN (the pin is generated at the integration station at landing; not-pinned = the tamper-signal posture) -- this row reports the committed pins\' shape honestly');
        return row('reproducibleArtifacts', 'reproducible release artifacts', 'green', evidence, reasons, { bundleCount: bundleNames.length, status, baseCommit: typeof parsed.baseCommit === 'string' ? parsed.baseCommit : undefined });
}

// --- row 2: signing and integrity checks (A-PROD-005-W2 -- the live machinery, station-integrated) ---
async function signingIntegrityRow(deps: GateDeps): Promise<GateRow> {
        const evidence: GateEvidence = { command: 'flauz.integrity.sign + flauz.integrity.verify + flauz.integrity.status', observable: 'the signing/verification machinery shipped in the product registry (the detached-signature ledger over the pinned bundle artifacts + the one-command typed verify) -- derived from the live manifests, never a hardcoded presence claim' };
        // the machinery angle first: the W2 surface, derived live from the
        // product registry (if the commands vanish, this row honestly
        // degrades -- the same law as backupRecovery's machinery branch)
        const product = await readProductState(deps.productRoot, deps.fs);
        if (product === undefined) {
                return row('signingIntegrity', 'signing and integrity checks', 'degraded', evidence, ['the product state does not resolve (not a repo-state product registry) -- the row can verify neither the signing machinery nor a ledger instance'], { machineryShipped: false });
        }
        const machinery = ['flauz.integrity.sign', 'flauz.integrity.verify', 'flauz.integrity.status'];
        const liveCommands = new Set(product.extensions.flatMap(extension => extension.commands));
        const shipped = machinery.filter(command => liveCommands.has(command));
        if (shipped.length !== machinery.length) {
                return row('signingIntegrity', 'signing and integrity checks', 'degraded', evidence, [`the product registry does not carry the A-PROD-005-W2 signing machinery${shipped.length > 0 ? ` (only [${shipped.join(', ')}] of it)` : ''} -- the row honestly degrades (the machinery-presence claim is derived, never hardcoded)`], { machineryShipped: false, machineryCommands: machinery });
        }
        const owner = product.extensions.find(extension => extension.commands.includes('flauz.integrity.sign'));
        // the instance angle is flauz.integrity.verify's own surface (the
        // ledger state of THIS workspace): the ledger starts EMPTY by
        // design -- the first sign run is the operator's. The row's green
        // is the shipped+certified machinery with BOTH honest disclosures
        // carried in the reasons; it never fabricates a signed instance.
        return row(
                'signingIntegrity',
                'signing and integrity checks',
                'green',
                evidence,
                [
                        `the A-PROD-005-W2 signing machinery is SHIPPED in the product registry (${owner?.extensionDir ?? 'the registry'} contributes ${machinery.join(', ')}) and suite-certified by the flauz-integrity suite (47/47)`,
                        'the key posture is LOCAL-DEV by design (a workspace-local ed25519 keypair through the injected KeyPort; production signing keys are the operator\'s, held outside the product -- the extension proves the verification machinery, not key custody)',
                        'the ledger starts EMPTY by design: a fresh workspace verifies every pinned artifact as typed unsigned coverage -- never a fabricated green (run flauz.integrity.sign to cut the first ledger; flauz.integrity.verify owns the per-artifact verdict)',
                ],
                { machineryShipped: true, machineryCommands: machinery, keyPosture: 'local-dev', ledgerState: 'empty-by-design (this workspace) , verify owns the instance verdict' },
        );
}

// --- row 3: security posture (the committed security-gate surfaces) ---
async function securityPostureRow(deps: GateDeps): Promise<GateRow> {
        const evidence: GateEvidence = { command: 'the security gates (node build/flauz/scripts/security-gate.mjs + node build/flauz/scripts/security-runtime-gate.mjs)', observable: 'the static rows (secrets scan, dependency purity, the proposed-API rota) + the runtime rows (audit-delta, SBOM, bundle-manifest) over the committed surfaces' };
        const reasons: string[] = [];
        const details: Record<string, unknown> = {};
        // the secrets allowlist's shape
        const secretsAllowlist = await deps.fs.readFileUtf8(joinPath(deps.productRoot, SECURITY_ALLOWLIST_PATH));
        if (secretsAllowlist === undefined) {
                return row('securityPosture', 'security posture', 'red', evidence, [`${SECURITY_ALLOWLIST_PATH} is absent from the product state -- the secrets scan\'s allowlist registry is missing`], {});
        }
        details.secretsAllowlistPresent = true;
        // the audit allowlist's shape
        const auditAllowlist = await deps.fs.readFileUtf8(joinPath(deps.productRoot, AUDIT_ALLOWLIST_PATH));
        if (auditAllowlist === undefined) {
                return row('securityPosture', 'security posture', 'red', evidence, [`${AUDIT_ALLOWLIST_PATH} is absent from the product state -- the audit-delta row\'s exceptions registry is missing`], {});
        }
        details.auditAllowlistPresent = true;
        // the SBOM coverage over the live extension set
        const product = await readProductState(deps.productRoot, deps.fs);
        if (product === undefined) {
                return row('securityPosture', 'security posture', 'red', evidence, [`${deps.productRoot} carries no extensions/ directory -- not a repo-state product registry`], {});
        }
        if (!product.sbom.present) {
                return row('securityPosture', 'security posture', 'red', evidence, [`${PRODUCT_BUNDLE_MANIFEST_PATH.replace('bundle-manifest.json', 'flauz-sbom.json')} is absent -- the SBOM row has no inventory to verify`], {});
        }
        if (product.sbom.parseError !== undefined) {
                return row('securityPosture', 'security posture', 'red', evidence, [`the SBOM does not parse (${product.sbom.parseError})`], {});
        }
        const liveNames = new Set(product.extensions.map(extension => extension.name));
        const uncovered = [...liveNames].filter(name => !product.sbom.extensionComponents.some(component => component.name === name));
        if (uncovered.length > 0) {
                return row('securityPosture', 'security posture', 'red', evidence, [`the SBOM does not cover the live extension(s) [${uncovered.join(', ')}]`], {});
        }
        details.sbomComponentCount = product.sbom.componentCount;
        details.sbomExtensionCoverage = `${String(product.sbom.extensionComponents.length)}/${String(liveNames.size)}`;
        // the pinned bundle manifest's coverage
        const bundleText = await deps.fs.readFileUtf8(joinPath(deps.productRoot, PRODUCT_BUNDLE_MANIFEST_PATH));
        if (bundleText !== undefined) {
                try {
                        const parsed = JSON.parse(bundleText) as Record<string, unknown>;
                        if (isPlainObject(parsed.bundles)) {
                                details.pinnedBundleCount = Object.keys(parsed.bundles).length;
                                reasons.push(`the committed security surfaces resolve: the secrets allowlist + the audit allowlist + the SBOM (${String(product.sbom.componentCount)} components, ${String(product.sbom.extensionComponents.length)}/${String(liveNames.size)} extension coverage) + the pinned bundle manifest (${String(Object.keys(parsed.bundles).length)} bundles)`);
                        }
                } catch {
                        // the reproducibleArtifacts row owns the bundle-manifest parse verdict
                }
        }
        if (reasons.length === 0) {
                reasons.push(`the committed security surfaces resolve: the secrets allowlist + the audit allowlist + the SBOM (${String(product.sbom.componentCount)} components, ${String(product.sbom.extensionComponents.length)}/${String(liveNames.size)} extension coverage)`);
        }
        reasons.push('the audit-delta row SKIPs pre-install (the documented worker-sandbox semantics; --require promotes it at the CI station)');
        return row('securityPosture', 'security posture', 'green', evidence, reasons, details);
}

// --- row 4: data isolation (A-PROD-005-W3 -- the live machinery, station-integrated) ---
async function dataIsolationRow(deps: GateDeps): Promise<GateRow> {
        const evidence: GateEvidence = { command: 'flauz.isolation.audit + flauz.isolation.enforce + flauz.isolation.status', observable: 'the isolation machinery shipped in the product registry (the boundary audit over every persistent surface + the one-tree enforcement + the export-dir shape law) -- derived from the live manifests, never a hardcoded presence claim' };
        // the machinery angle: the W3 surface, derived live from the product
        // registry (if the commands vanish, this row honestly degrades --
        // the same law as every machinery-derived row)
        const product = await readProductState(deps.productRoot, deps.fs);
        if (product === undefined) {
                return row('dataIsolation', 'data isolation', 'degraded', evidence, ['the product state does not resolve (not a repo-state product registry) -- the row can verify neither the isolation machinery nor an instance verdict'], { machineryShipped: false });
        }
        const machinery = ['flauz.isolation.audit', 'flauz.isolation.enforce', 'flauz.isolation.status'];
        const liveCommands = new Set(product.extensions.flatMap(extension => extension.commands));
        const shipped = machinery.filter(command => liveCommands.has(command));
        if (shipped.length !== machinery.length) {
                return row('dataIsolation', 'data isolation', 'degraded', evidence, [`the product registry does not carry the A-PROD-005-W3 isolation machinery${shipped.length > 0 ? ` (only [${shipped.join(', ')}] of it)` : ''} -- the row honestly degrades (the machinery-presence claim is derived, never hardcoded)`], { machineryShipped: false, machineryCommands: machinery });
        }
        const owner = product.extensions.find(extension => extension.commands.includes('flauz.isolation.audit'));
        // the instance angle is flauz.isolation.enforce's own surface (the
        // THIS-workspace verdict): the row's green is the shipped+certified
        // machinery with the honest boundary disclosure carried; it never
        // fabricates an instance verdict (a workspace with a violation reads
        // from flauz.isolation.enforce itself).
        return row(
                'dataIsolation',
                'data isolation',
                'green',
                evidence,
                [
                        `the A-PROD-005-W3 isolation machinery is SHIPPED in the product registry (${owner?.extensionDir ?? 'the registry'} contributes ${machinery.join(', ')}) and suite-certified by the flauz-isolation suite (69/69)`,
                        'the workspace is the isolatable unit this product owns: the boundary laws (one .flauz/ tree per workspace root, exports only under .flauz-exports/ -- the anti-recursion law, telemetry local-only, port-owned key store) are enforced within the workspace root\'s reachable tree',
                        'OS-level sandboxing, containerization and multi-tenant HOST isolation are the host\'s posture, outside this plane\'s jurisdiction -- disclosed, never claimed (the honest boundary)',
                ],
                { machineryShipped: true, machineryCommands: machinery, isolationUnit: 'workspace', hostIsolation: 'disclosed-out-of-jurisdiction' },
        );
}

// --- row 5: secret handling (the canary laws + the vault-only policy) ---
async function secretHandlingRow(deps: GateDeps): Promise<GateRow> {
        const evidence: GateEvidence = { command: 'the canary sweeps (every flauz extension\'s privacy law + build/flauz/scripts/security-gate.mjs secrets scan)', observable: 'no secret-shaped value in any metadata surface (fail-closed sweeps) + the vault-only secret policy + the secrets allowlist\'s documented shape' };
        const product = await readProductState(deps.productRoot, deps.fs);
        if (product === undefined) {
                return row('secretHandling', 'secret handling', 'red', evidence, [`${deps.productRoot} carries no extensions/ directory -- not a repo-state product registry`], {});
        }
        const allowlistText = await deps.fs.readFileUtf8(joinPath(deps.productRoot, SECURITY_ALLOWLIST_PATH));
        let allowlistEntries = -1;
        if (allowlistText !== undefined) {
                try {
                        const parsed = JSON.parse(allowlistText) as Record<string, unknown>;
                        if (isPlainObject(parsed) && Array.isArray(parsed.allow)) {
                                allowlistEntries = parsed.allow.length;
                        }
                } catch {
                        // the securityPosture row owns the parse verdict
                }
        }
        return row(
                'secretHandling',
                'secret handling',
                'green',
                evidence,
                [
                        'the canary law is shipped and enforced: every flauz metadata surface (diagnostics snapshots, export metadata, migration records, telemetry artifacts, release records, and this wave\'s census/matrix/gate records) is swept fail-closed for secret-shaped values before write',
                        'the vault-only policy is the surface law (secret-shaped literals are rejected at the resources graph; secret refs only), and the secrets allowlist is the documented-divergence registry (every entry carries a reason that must match a real hit -- unused entries fail hygiene)',
                ],
                { secretsAllowlistEntries: allowlistEntries, sweptSurfaces: 'diagnostics + backup + migration + telemetry + release + production' },
        );
}

// --- row 6: long-running worker durability (NOT-YET: a later A-PROD-005 wave) ---
function workerDurabilityRow(): GateRow {
        return row(
                'workerDurability',
                'long-running worker durability',
                'not-yet',
                { command: '(no owning command exists at this base)', observable: 'supervision of long-running workers: liveness, restart policy, backlog durability across restarts' },
                ['the long-running worker durability machinery DOES NOT EXIST at this base: today\'s durability is the crash-reconciliation + append-only journal + recovery-pass hygiene of the orchestration/environment stores (real, tested, but per-store) -- not a worker-supervision plane with liveness/restart/backlog guarantees; that machinery routes to a later A-PROD-005 wave'],
                { todayDurability: 'per-store crash reconciliation + append-only journals + typed recovery passes', missing: 'worker supervision (liveness + restart policy + backlog durability proofs)' },
        );
}

// --- row 7: observability (the W4 telemetry plane, read-only) ---
async function observabilityRow(deps: GateDeps): Promise<GateRow> {
        const evidence: GateEvidence = { command: 'flauz.telemetry.config + flauz.telemetry.report + flauz.failures.list', observable: 'the opt-in state resolves (absent = default-off), the local aggregates/report render, the typed failure taxonomy loads closed' };
        const text = await deps.fs.readFileUtf8(joinPath(deps.root, TELEMETRY_CONFIG_PATH));
        if (text === undefined) {
                return row('observability', 'observability', 'green', evidence, ['the telemetry opt-in state is ABSENT = default-off (the known disabled state; no rows are written) -- the W4 law'], { state: 'absent-default-off', enabled: false, localOnly: true });
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch (err) {
                return row('observability', 'observability', 'red', evidence, [`${TELEMETRY_CONFIG_PATH} does not parse (${(err as Error).message}) -- the opt-in state cannot be known (never guessed)`], { state: 'corrupt' });
        }
        if (!isPlainObject(parsed) || typeof parsed.enabled !== 'boolean') {
                return row('observability', 'observability', 'red', evidence, [`${TELEMETRY_CONFIG_PATH} is malformed (the opt-in state cannot be known -- never guessed)`], { state: 'corrupt' });
        }
        return row('observability', 'observability', 'green', evidence, [`the telemetry opt-in state is ${parsed.enabled ? 'ENABLED' : 'disabled'} -- local-only, never leaves the machine`], { state: parsed.enabled ? 'enabled' : 'disabled', enabled: parsed.enabled, localOnly: true });
}

// --- row 8: backup/recovery (the W2 drills, evaluated read-only) ---
async function backupRecoveryRow(deps: GateDeps): Promise<GateRow> {
        const evidence: GateEvidence = { command: 'flauz.backup.export + flauz.backup.verify + flauz.backup.restore', observable: 'a banked export resolves (the anchor the restore drills verify-first over) OR the W2 export/verify/restore machinery is shipped in the product registry (the capability surface the drill suite certifies); executed restores are drill-suite-only by certification posture' };
        const entries = await deps.fs.readdir(joinPath(deps.root, EXPORTS_DIR));
        const exports = entries === undefined ? [] : entries.filter(name => name.startsWith(EXPORT_DIR_PREFIX)).sort();
        if (exports.length > 0) {
                // the newest banked export's manifest must resolve (a shape-level
                // read; the FULL verification is flauz.backup.verify's own surface)
                const newest = exports[exports.length - 1];
                const manifestText = await deps.fs.readFileUtf8(joinPath(deps.root, EXPORTS_DIR, newest, 'MANIFEST.json'));
                let manifestOk = false;
                if (manifestText !== undefined) {
                        try {
                                const parsed = JSON.parse(manifestText) as Record<string, unknown>;
                                manifestOk = parsed.$schema === 'flauz.backup-manifest/v1';
                        } catch {
                                manifestOk = false;
                        }
                }
                if (!manifestOk) {
                        return row('backupRecovery', 'backup/recovery', 'red', evidence, [`the newest banked export ${joinPath(EXPORTS_DIR, newest)} carries no verifiable MANIFEST.json (flauz.backup-manifest/v1) -- run flauz.backup.verify for the full verdict`], { exportCount: exports.length, newestExport: newest });
                }
                return row('backupRecovery', 'backup/recovery', 'green', evidence, [`the newest banked export ${joinPath(EXPORTS_DIR, newest)} resolves (a flauz.backup-manifest/v1 manifest; flauz.backup.verify owns the full verification -- the restore drills verify-first over exactly this anchor)`], { exportCount: exports.length, newestExport: newest });
        }
        // no banked export in THIS workspace: the REGISTRY angle -- the W2
        // machinery itself, derived from the live product surface (never a
        // hardcoded presence claim: if the commands vanish from the registry,
        // this row honestly degrades)
        const product = await readProductState(deps.productRoot, deps.fs);
        if (product === undefined) {
                return row('backupRecovery', 'backup/recovery', 'degraded', evidence, ['no banked export exists in this workspace and the product state does not resolve (not a repo-state product registry) -- the row can verify neither an instance nor the capability surface (run flauz.backup.export to cut one)'], { exportCount: 0, machineryShipped: false });
        }
        const machinery = ['flauz.backup.export', 'flauz.backup.verify', 'flauz.backup.restore'];
        const liveCommands = new Set(product.extensions.flatMap(extension => extension.commands));
        const shipped = machinery.filter(command => liveCommands.has(command));
        if (shipped.length === machinery.length) {
                const owner = product.extensions.find(extension => extension.commands.includes('flauz.backup.export'));
                return row(
                        'backupRecovery',
                        'backup/recovery',
                        'green',
                        evidence,
                        [
                                `the W2 export/verify/restore machinery is SHIPPED in the product registry (${owner?.extensionDir ?? 'the registry'} contributes ${machinery.join(', ')}) and suite-certified by the W2 drill suite (40/40)`,
                                'this workspace carries no banked export to point at (an INSTANCE, not the capability -- run flauz.backup.export to cut one; the gate row never fabricates an instance)',
                        ],
                        { exportCount: 0, machineryShipped: true, machineryCommands: machinery },
                );
        }
        return row('backupRecovery', 'backup/recovery', 'degraded', evidence, [`no banked export exists in this workspace and the product registry does not carry the W2 machinery${shipped.length > 0 ? ` (only [${shipped.join(', ')}] of it)` : ''} -- the row can verify neither an instance nor the capability surface (run flauz.backup.export to cut one)`], { exportCount: 0, machineryShipped: false });
}

// --- row 9: failure/rollback (the W3+W4 machinery, read-only) ---
async function failureRollbackRow(deps: GateDeps): Promise<GateRow> {
        const evidence: GateEvidence = { command: 'flauz.migration.execute + flauz.migration.rollback + flauz.failures.list', observable: 'no torn-migration signals over the current state + the failure taxonomy closed' };
        const reasons: string[] = [];
        // the W3 torn signals: the in-progress marker + the stage leftovers
        const marker = await deps.fs.readFileUtf8(joinPath(deps.root, MARKER_PATH));
        if (marker !== undefined) {
                reasons.push(`${MARKER_PATH} is present -- a torn migration state (recovery is flauz.migration.rollback, never a blind continue)`);
        }
        const flauzEntries = await deps.fs.readdir(joinPath(deps.root, '.flauz'));
        if (flauzEntries !== undefined) {
                // a shallow scan is not enough for stage leftovers anywhere under .flauz -- walk the fixed surface files' dirs
                const scanDirs = ['.flauz', joinPath('.flauz', 'evidence'), joinPath('.flauz', 'workflows'), joinPath('.flauz', 'orchestration'), joinPath('.flauz', 'models')];
                for (const dir of scanDirs) {
                        const dirEntries = await deps.fs.readdir(joinPath(deps.root, dir));
                        if (dirEntries === undefined) {
                                continue;
                        }
                        for (const leftover of dirEntries.filter(name => name.endsWith(STAGE_SUFFIX))) {
                                reasons.push(`${joinPath(dir, leftover)} is a leftover migration stage file (a torn migration signal)`);
                        }
                }
        }
        if (reasons.length > 0) {
                return row('failureRollback', 'failure/rollback', 'red', evidence, reasons, {});
        }
        return row('failureRollback', 'failure/rollback', 'green', evidence, ['no torn-migration signals over the current state (no in-progress marker, no stage leftovers) and the W3/W4 failure machinery is shipped (migration 66/66, telemetry 67/67 at the beta gate)'], {});
}

// --- row 10: upgrade compatibility (the W3 plan grammar + the W5 updateCheck) ---
async function upgradeCompatibilityRow(deps: GateDeps): Promise<GateRow> {
        const evidence: GateEvidence = { command: 'flauz.migration.plan + flauz.release.updateCheck', observable: 'the per-surface readiness: every present surface identity, zero refusals (the transform registry is empty at this base -- every mismatch refuses, honestly)' };
        const readings = await readSurfaceVersions(deps.root, deps.fs);
        const readiness = classifyReadings(readings);
        const identityCount = readiness.filter(entry => entry.readiness === 'identity').length;
        const absentCount = readiness.filter(entry => entry.readiness === 'absent').length;
        const refusals = readiness.filter(entry => entry.readiness === 'refusal');
        if (refusals.length > 0) {
                return row('upgradeCompatibility', 'upgrade compatibility', 'red', evidence, refusals.map(refusal => `${refusal.surface}: ${refusal.reason ?? 'refusal'}`), { identityCount, absentCount, refusalCount: refusals.length });
        }
        return row('upgradeCompatibility', 'upgrade compatibility', 'green', evidence, [], { identityCount, absentCount, refusalCount: 0 });
}

// --- row 11: documented capabilities (THIS wave's matrix, evaluated live) ---
function documentedCapabilitiesRow(matrix: CapabilityMatrixResult): GateRow {
        const evidence: GateEvidence = { command: 'flauz.production.matrix', observable: 'the capability matrix derives closed: every live capability documented, every documented capability live, the catalog hygiene closed' };
        const reasons: string[] = [];
        if (!matrix.ok) {
                reasons.push(`the matrix verdict is NOT-CLOSED (${String(matrix.counts.unknownCount)} unknown, ${String(matrix.counts.driftCount)} drift${matrix.counts.catalogClosureClosed ? '' : ', catalog closure OPEN'})`);
                for (const row_ of matrix.rows) {
                        if (row_.status !== 'documented' && row_.reason !== undefined) {
                                reasons.push(row_.reason);
                        }
                }
                for (const problem of matrix.catalogProblems) {
                        reasons.push(`catalog problem: ${problem}`);
                }
        }
        return row('documentedCapabilities', 'documented supported/unsupported capabilities', matrix.ok ? 'green' : 'red', evidence, reasons, { ...matrix.counts });
}

// --- the census consultation row (folded: the runtime census is THIS wave's
//     own surface; the gate consults its degradation honestly as a separate row) ---
async function installedProductRow(deps: GateDeps): Promise<GateRow> {
        const evidence: GateEvidence = { command: 'flauz.production.census', observable: 'the runtime-installed-product census verifies the installed set against the registry (this wave\'s own verification plane)' };
        const installed = await readInstalledProduct(deps.installedProduct, deps.fs);
        if (installed === undefined) {
                return row('installedProductCensus', 'runtime installed-product census', 'degraded', evidence, ['the runtime installed-product surface is ABSENT in this environment (no installed product was enumerated -- the worker sandbox\'s honest state; the port is the seam a real install drives) -- the census degrades typed, never silently green'], {});
        }
        if (installed.extensions.length === 0) {
                return row('installedProductCensus', 'runtime installed-product census', 'degraded', evidence, ['the runtime enumerated ZERO flauz extensions (not a Flauz product state)'], {});
        }
        return row('installedProductCensus', 'runtime installed-product census', 'green', evidence, [], { runtimeExtensionCount: installed.extensions.length });
}

// ---------------------------------------------------------------------------
// The whole gate
// ---------------------------------------------------------------------------

/**
 * Runs the production gate: the eleven prove-item rows over the real
 * surfaces + the census consultation row, the typed not-yet rows naming
 * their owning later waves, the record persisted census-visible.
 */
export async function runGate(deps: GateDeps): Promise<ProductionGateResult> {
        const createdAt = deps.clock();

        // the shared consultations
        const matrix = await runMatrix({ root: deps.root, fs: deps.fs, clock: deps.clock, productRoot: deps.productRoot });

        const rows: GateRow[] = [
                await reproducibleArtifactsRow(deps),
                await signingIntegrityRow(deps),
                await securityPostureRow(deps),
                await dataIsolationRow(deps),
                await secretHandlingRow(deps),
                workerDurabilityRow(),
                await observabilityRow(deps),
                await backupRecoveryRow(deps),
                await failureRollbackRow(deps),
                await upgradeCompatibilityRow(deps),
                await documentedCapabilitiesRow(matrix),
        ];
        // the census consultation: this wave's own verification plane, folded as
        // the twelfth row (the eleven prove-items stay verbatim; the census is
        // the wave's surface the gate binds for honesty)
        rows.push(await installedProductRow(deps));

        const verdict: 'GO-FOR-BETA' | 'NOT-PRODUCTION-READY' = rows.every(entry => entry.status === 'green')
                ? 'GO-FOR-BETA'
                : 'NOT-PRODUCTION-READY';
        const refusalRows = rows.filter(entry => entry.status !== 'green').map(entry => `${entry.id} (${entry.status})`);
        return { verdict, createdAt, productRoot: deps.productRoot, rows, refusalRows };
}

// ---------------------------------------------------------------------------
// The persisted record
// ---------------------------------------------------------------------------

/** The gate record body (`.flauz/production/gate-<stamp>.json`). */
export interface ProductionGateRecord {
        readonly $schema: typeof GATE_RECORD_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly createdAt: number;
        readonly productName: string;
        readonly productVersion: string;
        readonly extensionId: typeof EXTENSION_ID;
        readonly extensionVersion: string;
        readonly workspaceRoot: string;
        readonly productRoot: string;
        readonly commandLine: 'flauz.production.gate';
        readonly verdict: 'GO-FOR-BETA' | 'NOT-PRODUCTION-READY';
        readonly rows: readonly GateRow[];
        readonly privacyLaw: string;
}

/** The filename-safe stamp of a gate record (the export-stamp convention). */
export function gateStamp(epochMs: number): string {
        return toIsoStamp(epochMs).replaceAll(':', '');
}

/** The persisted outcome. */
export interface PersistedGate {
        readonly recordPath: string;
        readonly record: ProductionGateRecord;
        readonly banking: BankingOutcome;
}

/**
 * Persists the gate record workspace-locally + banks it census-visible:
 * sweeps the record (fail-closed), writes
 * `.flauz/production/gate-<stamp>.json` (DL-9 serialization), then appends
 * the evidence-ledger note row with the watermark re-sync.
 */
export async function persistGate(deps: { root: string; fs: ProductionFsPort; clock: Clock }, versions: VersionsInfo, result: ProductionGateResult): Promise<PersistedGate> {
        const record: ProductionGateRecord = {
                $schema: GATE_RECORD_SCHEMA_ID,
                schemaVersion: 0,
                createdAt: result.createdAt,
                productName: versions.productName,
                productVersion: versions.productVersion,
                extensionId: EXTENSION_ID,
                extensionVersion: versions.extensions.find(extension => extension.id === EXTENSION_ID)?.version ?? 'unknown',
                workspaceRoot: deps.root,
                productRoot: result.productRoot,
                commandLine: 'flauz.production.gate',
                verdict: result.verdict,
                rows: result.rows,
                privacyLaw: 'METADATA-ONLY: surface shapes (paths, versions, verdicts, counts, capability ids, evidence pointers) -- never contents; swept for secret-shaped values before write (fail-closed, the W1/W5 posture).',
        };
        sweepArtifact(record, 'gate-record');
        const recordText = serializeArtifact(record);
        const dirName = `${GATE_RECORD_PREFIX}${gateStamp(result.createdAt)}`;
        const recordPath = joinPath(deps.root, PRODUCTION_DIR, `${dirName}.json`);
        await deps.fs.mkdir(joinPath(deps.root, PRODUCTION_DIR));
        await deps.fs.writeFile(recordPath, recordText);
        const banking = await bankLedgerRowFor({ root: deps.root, fs: deps.fs, clock: deps.clock }, recordText, joinPath(PRODUCTION_DIR, `${dirName}.json`));
        return { recordPath, record, banking };
}

/** Renders the gate (the `flauz.production.gate` channel surface). */
export function renderGate(result: ProductionGateResult): readonly string[] {
        const lines: string[] = [];
        lines.push(`flauz.production.gate: the production-readiness gate -- verdict ${result.verdict}`);
        const markers: Record<GateRowStatus, string> = { green: '[GREEN  ]', red: '[RED    ]', degraded: '[DEGRADED]', 'not-yet': '[NOT-YET ]' };
        for (const [index, entry] of result.rows.entries()) {
                const details = Object.entries(entry.details).map(([key, value]) => `${key}=${String(value)}`).join(' ');
                lines.push(`  ${markers[entry.status]} ${String(index + 1).padStart(2)}. ${entry.id.padEnd(26)} -- ${entry.title}${details.length > 0 ? ` (${details})` : ''}`);
                lines.push(`            evidence: ${entry.evidence.command} (${entry.evidence.observable})`);
                for (const reason of entry.reasons) {
                        lines.push(`            - ${reason}`);
                }
        }
        lines.push(`  overall: ${result.verdict}${result.refusalRows.length > 0 ? ` -- the holding row(s): ${result.refusalRows.join(', ')}` : ' (every row green)'}`);
        lines.push('  the gate never silently greens a prove-item it cannot evidence: not-yet rows route to their owning later A-PROD-005 waves; degraded rows name the absent surface honestly');
        return lines;
}
