/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The documented capability catalog (A-PROD-005-W1 -- the matrix's data
 * half): the product's supported/unsupported statement, one entry per
 * capability, each owning its command surface (the capability id is the
 * stable documentation key; the owning commands are the derivable surface
 * the matrix matches against the live manifests).
 *
 * THE DERIVATION LAW (the matrix's drift protection): the catalog NEVER
 * defines the product's capability SET -- the live manifests do (every
 * `contributes.commands[].command` of every extension the registries name).
 * The catalog documents what each of those capabilities does and does NOT
 * do. A command discovered in the product with no catalog entry is a typed
 * UNKNOWN disclosure (the matrix refuses to guess a boundary it was never
 * told); a catalog entry whose commands are absent from the product is a
 * typed DRIFT disclosure (the documentation no longer matches the shipped
 * surface). The closure check (below) additionally pins the catalog's own
 * hygiene: unique capability ids, every command claimed by exactly one
 * entry, non-empty statements everywhere.
 *
 * THE HONESTY LAW: every `unsupported` boundary is a DELIBERATE scope
 * statement, not an apology -- the three the work order names verbatim:
 * executed restores are drill-suite-only; the transform registry is empty
 * at this base so every version mismatch refuses; telemetry is local-only
 * and never leaves the machine.
 */

/** One documented capability (the matrix's row data). */
export interface CapabilityDef {
        /** The capability id (the stable documentation key). */
        readonly id: string;
        /** The owning extension's directory name (e.g. `flauz-backup`). */
        readonly owner: string;
        /** The owning command ids (the derivable surface the matrix matches on). */
        readonly commands: readonly string[];
        /** The evidence class: which wave landed the capability. */
        readonly wave: string;
        /** The evidence class: which gate/suite certifies it. */
        readonly gate: string;
        /** The SUPPORTED envelope: what the capability does. */
        readonly supported: string;
        /** The honest UNSUPPORTED boundary: what the capability deliberately does NOT do. */
        readonly unsupported: string;
}

/** The complete documented catalog, in product order (the matrix derives its rows from the live surface set, matched against this). */
export const CAPABILITY_CATALOG: readonly CapabilityDef[] = [
        // --- flauz-agent (the Agent Bridge core; the TL2 Agent-OS lane hardened it) ---
        {
                id: 'agent-task-surface',
                owner: 'flauz-agent',
                commands: ['flauz.showTasks', 'flauz.agent.takeoverStep', 'flauz.focusView.agentSessions', 'flauz.agent.refreshSessions'],
                wave: 'the Agent Bridge core (the F-lane landings; the TL2 Agent-OS surge hardened the store)',
                gate: 'the flauz-agent suite + the agentos-battery rows (build/flauz/scripts/agentos-battery.mjs)',
                supported: 'the task envelope surface: listing Flauz tasks, taking over an orchestration step (the human-over-agent handoff with provenance), and the agent-sessions tree view with its refresh path.',
                unsupported: 'the task envelope is workspace-local (one .flauz/ tree per workspace root; no cross-workspace aggregation exists at this base), and takeover reassigns the step -- it never edits completed history (append-only provenance is the law).',
        },
        {
                id: 'agent-evidence-verify',
                owner: 'flauz-agent',
                commands: ['flauz.verifyLedger'],
                wave: 'the Agent Bridge core (the F-lane landings; DL-20 hardened checkpoints arrived with the TL3 workflow lane)',
                gate: 'the flauz-workflow hardening suite (the delegated dynamic row, flauz-workflow.yml) + the flauz-agent suite',
                supported: 'verifies the evidence ledger chain (the hash-linked note/evidence rows) and renders the verdict.',
                unsupported: 'verification only -- a broken chain is REPORTED, never auto-repaired (recovery routes to the backup/restore plane, which itself refuses over an unverifiable state); the verifier never rewrites a row.',
        },
        // --- flauz-backup (A-PROD-004-W2, PR #133) ---
        {
                id: 'backup-export',
                owner: 'flauz-backup',
                commands: ['flauz.backup.export', 'flauz.backup.verify'],
                wave: 'A-PROD-004-W2 (PR #133) -- the durable-state backup/export wave',
                gate: 'the flauz-backup suite (40 tests) + the W2 drill rows the flauz-release checklist binds',
                supported: 'a byte-identical export of the durable .flauz/ census surfaces (per-surface MANIFEST.json with sha256+bytes per file, export-time integrity verdicts, the state/ copy) and a verifier that re-derives green/tampered/torn per surface over any banked export.',
                unsupported: 'exports are workspace-local in v0 (no network sync, no remote sink -- an export never leaves the machine) and the verifier checks structure + hashes, not cryptographic signatures (signing is a later A-PROD-005 wave); absent surfaces are listed absent, never faked.',
        },
        {
                id: 'backup-restore',
                owner: 'flauz-backup',
                commands: ['flauz.backup.restore'],
                wave: 'A-PROD-004-W2 (PR #133) -- the crash-recovery half of the backup wave',
                gate: 'the flauz-backup suite (the restore drills) + the W2 recovery rows',
                supported: 'the verify-first restore path: an export must verify green before any byte moves, per-surface atomic stage+rename, a recovery record banked into the restored state, and the consent enumeration (which non-empty targets an operator must approve).',
                unsupported: 'EXECUTED RESTORES ARE DRILL-SUITE-ONLY in the product\'s certification posture: the automated suites restore into fixture workspaces; a production restore is an operator-driven destructive act (force-gated, consent-enumerated), and the product ships no scheduled/automatic restore of any kind. A restore over a torn current state refuses (verify-first is the law).',
        },
        // --- flauz-browser (the TL3 browser lane) ---
        {
                id: 'browser-policy',
                owner: 'flauz-browser',
                commands: ['flauz.browser.setPolicy', 'flauz.browser.showPolicy', 'flauz.browser.verifyPolicy', 'flauz.browser.checkUrl', 'flauz.browser.evaluate'],
                wave: 'the TL3 browser lane (B-POLICY A4-A10; the deny-by-default + forced-reset hardening rungs)',
                gate: 'the flauz-browser suite (161+ tests) + the B-POLICY drill (build/flauz/scripts/b-policy-boot-drill.mjs) + the delegated dynamic rows in flauz-browser.yml',
                supported: 'the browser policy plane: authoring/opening the policy file, rendering the effective policy, verifying it, and pre-checking URLs/decisions against it (deny-by-default navigation, forced-reset EXECUTION through the policy engine, partition-scoped tab ownership).',
                unsupported: 'policy is deny-by-default: an unlisted navigation is denied (there is no allow-everything mode and no wildcard allow); the policy engine gates CDP commands -- it is not a content filter (page CONTENT is never inspected, only the URL/decision shape); human sessions are never UA-overridden (the agent product token is agent-sessions-only).',
        },
        {
                id: 'browser-sessions',
                owner: 'flauz-browser',
                commands: ['flauz.browser.openSession', 'flauz.browser.closeSession', 'flauz.browser.sessions', 'flauz.browser.navigate', 'flauz.browser.screenshot', 'flauz.focusView.browser', 'flauz.browser.refreshView'],
                wave: 'the TL3 browser lane (the session manager + the real-Chromium completion rung)',
                gate: 'the flauz-browser suite + the real-Chromium hardening drill (SKIP without FLAUZ_CDP_ENDPOINT, never a false green) + the session-journal PIN-1 contract',
                supported: 'the agent/human browser session plane: opening/closing sessions (separate identities, deterministic agent UA), policy-gated navigation, screenshot capture to evidence rows, the sessions view, and the append-only session journal (.flauz/browser-sessions.jsonl) the resources lane bridges.',
                unsupported: 'the runtime CDP endpoint is required for real navigation (the suite\'s fake transport covers the contract; the real drill is optional-by-flag and never fakes a pass); popups/new targets are closed unless policy-approved; downloads are deny-by-default with NO allow surface in v0.',
        },
        // --- flauz-diagnostics (A-PROD-004-W1, PR #128) ---
        {
                id: 'diagnostics-surface',
                owner: 'flauz-diagnostics',
                commands: ['flauz.diag.show'],
                wave: 'A-PROD-004-W1 (PR #128) -- the diagnostics + support/debug bundle wave',
                gate: 'the flauz-diagnostics suite (31 tests)',
                supported: 'the durable-state census render: every artifact class\'s presence, counts and digests (COUNTS AND HASHES ONLY), the versions block, the environment info.',
                unsupported: 'the census enumerates SHAPES, never CONTENTS (free-form text fields are never projected); it reports, it never repairs; no cross-machine aggregation exists (each census reads one workspace root).',
        },
        {
                id: 'support-bundle',
                owner: 'flauz-diagnostics',
                commands: ['flauz.diag.bundle'],
                wave: 'A-PROD-004-W1 (PR #128) -- the support/debug bundle half',
                gate: 'the flauz-diagnostics suite (the bundle artifact-class rows)',
                supported: 'generates the support/debug bundle workspace-locally: the diagnostics snapshot + the census-visible artifact summaries an operator can attach to an issue.',
                unsupported: 'the bundle is metadata-only (shapes, counts, hashes -- the privacy law); it is never auto-uploaded anywhere (no telemetry, no network), and it carries no durable-state contents.',
        },
        // --- flauz-environments (the TL3 environments lane + A-PROD-004 consultation) ---
        {
                id: 'environment-registry',
                owner: 'flauz-environments',
                commands: ['flauz.env.list', 'flauz.env.register', 'flauz.env.unregister', 'flauz.env.activate', 'flauz.env.deactivate', 'flauz.env.showPlan', 'flauz.env.switch'],
                wave: 'the TL3 environments lane (PIN-2 store + the trust-posture gate)',
                gate: 'the flauz-environments suite + the C-ENV canary (build/flauz/scripts/env-registry-canary.mjs)',
                supported: 'the environment registry: listing, registering (descriptor-validated), unregistering, activating/deactivating, the connection plan render, and the switch path (re-open continuity).',
                unsupported: 'registry entries are descriptor-validated but the registry is workspace-local (no org-level sharing at this base); an untrusted trust posture fails the start/attach gates fail-closed (there is no override flag); unregister is refused while an environment is live.',
        },
        {
                id: 'environment-lifecycle',
                owner: 'flauz-environments',
                commands: ['flauz.env.create', 'flauz.env.start', 'flauz.env.stop', 'flauz.env.attach', 'flauz.env.detach', 'flauz.env.snapshot', 'flauz.env.destroy', 'flauz.env.status'],
                wave: 'the TL3 environments lifecycle landing (the typed state machine + the LOCAL-REAL executor)',
                gate: 'the flauz-environments suite (the lifecycle + crash-reconciliation rows)',
                supported: 'the typed lifecycle (registered -> created -> starting -> running <-> stopping -> stopped -> destroyed, + failed; illegal transitions are typed errors), the LOCAL-REAL local-process executor with real terminate/reap + SIGKILL escalation, sha256 snapshot manifests, and orphan/stale crash reconciliation.',
                unsupported: 'the remote executors (ssh/container/cloud-sandbox) are TEST INFRASTRUCTURE with explicit simulated opt-in -- no real remote provider ships at this base (real providers were the TL3-004 seam and only the local-loopback posture is product); lifecycle ops carry MANDATORY provenance (no anonymous mutations).',
        },
        {
                id: 'environment-continuity',
                owner: 'flauz-environments',
                commands: ['flauz.continuity.status', 'flauz.continuity.verify', 'flauz.continuity.restore', 'flauz.continuity.export'],
                wave: 'the TL3 continuity landing (the executable continuity capability)',
                gate: 'the flauz-environments continuity suite (37 fixtures + the restore drills)',
                supported: 'continuity bundles: export (the N-8 surface canon from real .flauz/ state with the SECRET-REDACTION LAW), verify (manifest + ledger), status, and the force-gated atomic restore.',
                unsupported: 'the secret-redaction law is absolute: secret-shaped surfaces record presence + path hash, NEVER payloads (a restored bundle never re-materializes a secret); restore is destructive-class (force-gated, fail-closed on untrusted targets); bundles are workspace-local files, never network-synced.',
        },
        {
                id: 'environment-resolver',
                owner: 'flauz-environments',
                commands: ['flauz.env.resolver', 'flauz.env.resolve'],
                wave: 'the TL3 environments lane (the resolver status + authority resolution)',
                gate: 'the flauz-environments suite (the resolver rows) + the cenv-resolver boot drill',
                supported: 'renders the environment resolver status and resolves the environment authority (which environment a workspace resolves to, and why).',
                unsupported: 'resolution is read-only (it never switches or mutates the registry); the resolvers proposed-API grant is absent at this base (DL-33 -- remote-authority resolution is not shipped).',
        },
        {
                id: 'environments-view',
                owner: 'flauz-environments',
                commands: ['flauz.focusView.environments', 'flauz.env.refreshView'],
                wave: 'the TL4-001 IA shell (the six-view workbench surface)',
                gate: 'the ia-gate (build/flauz/scripts/ia-gate.mjs) + the premium-ux-gate',
                supported: 'the environments tree view with its lifecycle state/last-op rows, error rows with Retry, and the focus/refresh commands.',
                unsupported: 'the view renders state; it never mutates it (every mutation routes through the lifecycle/registry commands with provenance); last-known-good recovery keeps prior rows on a failed refresh (stale data is labeled, never silently fresh).',
        },
        // --- flauz-execution (the TL2-S2 landing) ---
        {
                id: 'execution-journal',
                owner: 'flauz-execution',
                commands: ['flauz.exec.status', 'flauz.exec.verify'],
                wave: 'the TL2 execution landing (PR #28 -- the resource-acquisition journal)',
                gate: 'the flauz-execution suite (99 tests at landing; the SBOM rows caught by the security gate)',
                supported: 'the execution resource-acquisition journal: the status render and the journal verifier (every acquisition/release is recorded, typed and hash-linked).',
                unsupported: 'the journal records acquisitions -- it does not enforce quotas (the budget gate owns the budgets); it is workspace-local and never auto-shipped anywhere.',
        },
        // --- flauz-memory (the TL2 memory lane) ---
        {
                id: 'memory-tiers',
                owner: 'flauz-memory',
                commands: ['flauz.memory.record', 'flauz.memory.list', 'flauz.memory.move', 'flauz.memory.compact', 'flauz.memory.verify', 'flauz.memory.index'],
                wave: 'the TL2 memory landing (the tiered memory journal)',
                gate: 'the flauz-memory suite (48 tests at the F2b station receipt)',
                supported: 'the tiered memory plane: recording, listing, moving between tiers, compacting, verifying and indexing memory records.',
                unsupported: 'memory records are workspace-local (no embedding store, no cloud retrieval at this base); compaction is lossless-by-record (records are compacted, never silently dropped); the verifier reports, it never reconstructs.',
        },
        // --- flauz-migration (A-PROD-004-W3, PR #134) ---
        {
                id: 'migration-plan',
                owner: 'flauz-migration',
                commands: ['flauz.migration.plan'],
                wave: 'A-PROD-004-W3 (PR #134) -- the migration/upgrade safety wave',
                gate: 'the flauz-migration suite (66 tests) + the W3 plan-grammar rows the flauz-release update check mirrors',
                supported: 'the pre-flight plan: reads every surface\'s actual format version, classifies identity/transform/refusal per surface, refuses over torn state, and renders exactly what an execution would do.',
                unsupported: 'THE TRANSFORM REGISTRY IS EMPTY AT THIS BASE: every version mismatch is a REFUSAL (the honest W3 scope -- no bridging transform ships), so a plan over an unrecognized/future-versioned surface is a no-go plan, never a silent upgrade; the plan writes NOTHING (no anchor, no marker, no state change).',
        },
        {
                id: 'migration-execute-rollback',
                owner: 'flauz-migration',
                commands: ['flauz.migration.execute', 'flauz.migration.rollback'],
                wave: 'A-PROD-004-W3 (PR #134) -- the anchor-first execute + verify-first rollback',
                gate: 'the flauz-migration suite (the anchor/rollback drills) + the W3 rows the flauz-release checklist binds',
                supported: 'the anchor-first execution (a verified rollback anchor exists BEFORE any surface moves; per-surface atomic stage+rename; the in-progress marker) and the verify-first rollback (the anchor must verify; the recovery record is banked into the restored state).',
                unsupported: 'with the empty transform registry an execution is all-identity or refused (no cross-version transform executes); rollback targets the ANCHOR state (no partial/selected-surface rollback in v0); a torn migration refuses both directions until recovered (recovery is explicit, never automatic).',
        },
        // --- flauz-models (the TL3 models lane) ---
        {
                id: 'models-view',
                owner: 'flauz-models',
                commands: ['flauz.focusView.models', 'flauz.models.refreshView'],
                wave: 'the TL4-001 IA shell (the models view) over the TL3 models core',
                gate: 'the ia-gate + the premium-ux-gate (the Models no-failure-source exemption) + the flauz-models suite',
                supported: 'the models tree view: the provider lanes, their enabled/disabled state and the routing policy, with focus/refresh.',
                unsupported: 'the VIEW is read-only (lane switching and policy edits are state-side operations -- the view never mutates the routing policy); provider credentials are vault-only (the view renders presence, never values).',
        },
        {
                id: 'provider-lanes',
                owner: 'flauz-models',
                commands: [],
                wave: 'the TL3 models lane (the vendor-neutral ProviderAdapter contract, DL-34) + the F-lane retry hardening',
                gate: 'the flauz-models suite (106 tests at the F2b station receipt) + the agentos-battery provider rows',
                supported: 'the provider-lane state plane (state-side, no command surface of its own): the provider registry, the routing policy, the routing decisions journal and the provider-switch journal -- the seam the agent runtime and the views consult.',
                unsupported: 'zero vendor SDKs (the adapter contract only); credentials resolve through the vault (raw keys are rejected in config); the production transform/refusal semantics are the migration plane\'s (a malformed lane state is a typed failure, never a silent skip).',
        },
        // --- flauz-release (A-PROD-004-W5, PR #136) ---
        {
                id: 'release-verify',
                owner: 'flauz-release',
                commands: ['flauz.release.verify'],
                wave: 'A-PROD-004-W5 (PR #136) -- the install/update reliability plane',
                gate: 'the flauz-release suite (75 tests) + the W5 five-class check rows',
                supported: 'the install verification against the REPO-STATE PRODUCT: the extension census (every packaged extension present + activation-lint clean), the packaging-parity contract, the SBOM coverage, the W1 census clean, and the W2 integrity verdicts with a fresh self-export that must verify -- the record persisted census-visible.',
                unsupported: 'the verification runs against the REPO-STATE PRODUCT (extensions/flauz-* manifests + the registries), NOT the runtime-installed product -- that angle is THIS wave\'s lane (flauz.production.census); a workspace without the repo-state product gets the typed refusal, never a guessed verdict.',
        },
        {
                id: 'release-update-check',
                owner: 'flauz-release',
                commands: ['flauz.release.updateCheck'],
                wave: 'A-PROD-004-W5 (PR #136) -- the pre-update gate',
                gate: 'the flauz-release suite (the readiness-matrix rows)',
                supported: 'the pre-flight: censuses the current state, reads the per-surface format versions, reports the readiness matrix (identity/transform/refusal) + the anchor dry-run (what an anchor WOULD copy).',
                unsupported: 'NEVER performs the update (the migration stays in flauz-migration\'s hands) and writes NOTHING: no plan, no anchor, no marker; with the empty transform registry every mismatch is a refusal row.',
        },
        {
                id: 'release-checklist',
                owner: 'flauz-release',
                commands: ['flauz.release.checklist'],
                wave: 'A-PROD-004-W5 (PR #136) -- the beta gate\'s closure evidence',
                gate: 'the flauz-release suite (the go/no-go rows) + the artifact re-read cycle',
                supported: 'the one-command go/no-go binding ALL TEN beta capabilities, every row with its evidence pointer; GO only when all ten are green; the artifact persisted with its checklistId re-derived on re-read.',
                unsupported: 'the checklist consults and records -- it NEVER repairs, migrates or restores; a red/unknown row is reported with the exact reason (a corrupt telemetry config means the opt-in state cannot be known -- UNKNOWN, never guessed green).',
        },
        // --- flauz-resources (the TL3 resources lane) ---
        {
                id: 'resource-graph',
                owner: 'flauz-resources',
                commands: ['flauz.res.list', 'flauz.res.show', 'flauz.res.graph', 'flauz.res.verify', 'flauz.res.syncBrowserSessions'],
                wave: 'the TL3 resources landing (the ResourceRef graph + the provenance ledger)',
                gate: 'the flauz-resources suite (93 tests at the C2 station receipt) + the R-RES canary',
                supported: 'the resource graph: logical URN refs with mandatory provenance, kind-specific surfaces, typed edges with legality, surface versioning, the append-only ops ledger, listing/show/graph/verify, and the browser-session journal bridge.',
                unsupported: 'SECRET REFS ARE VAULT-ONLY (secret-shaped literals are rejected at the surface law -- the graph records the ref, never the value); the graph is workspace-local (no cross-workspace federation); verify reports, it never repairs.',
        },
        // --- flauz-telemetry (A-PROD-004-W4, PR #135) ---
        {
                id: 'telemetry-config',
                owner: 'flauz-telemetry',
                commands: ['flauz.telemetry.config'],
                wave: 'A-PROD-004-W4 (PR #135) -- the explicit-privacy-controls half',
                gate: 'the flauz-telemetry suite (67 tests) + the W4 opt-in rows the flauz-release checklist binds',
                supported: 'the opt-in configuration surface: inspect the declared schema first, then enable/disable with the recorded consent action; ABSENT config = default-off (a known state).',
                unsupported: 'the opt-in state may NEVER be guessed (a corrupt config is an UNKNOWN state, never a default); retention is bounded ([1, 3650] days); there is no org-policy override that silently flips a user\'s disabled state.',
        },
        {
                id: 'telemetry-local-record',
                owner: 'flauz-telemetry',
                commands: ['flauz.telemetry.record', 'flauz.telemetry.report'],
                wave: 'A-PROD-004-W4 (PR #135) -- the local-only aggregate plane',
                gate: 'the flauz-telemetry suite (the aggregate + report rows)',
                supported: 'records session aggregates (typed failure classes, timing shapes) into the local store and renders the local report.',
                unsupported: 'TELEMETRY IS LOCAL-ONLY AND NEVER LEAVES THE MACHINE: the record path writes the workspace-local store, the report renders locally, and NO network transport exists in the product (no upload endpoint, no background sender); recording is opt-in-gated (default-off means no rows are written at all).',
        },
        {
                id: 'failure-census',
                owner: 'flauz-telemetry',
                commands: ['flauz.failures.list'],
                wave: 'A-PROD-004-W4 (PR #135) -- the typed failure-taxonomy half',
                gate: 'the flauz-telemetry suite (the taxonomy-closure rows pinned class-for-class against the real vocabularies)',
                supported: 'the recent-failure census: typed provider/environment failures grouped by the 14-class taxonomy with remediation hints.',
                unsupported: 'the census renders RECORDED failures only (it never probes providers to generate failures); remediation text is advisory (the product never auto-retries beyond the bounded providerRetry contract) and never auto-switches lanes.',
        },
        // --- flauz-workflow (the TL3 workflow lane) ---
        {
                id: 'workflow-envelopes',
                owner: 'flauz-workflow',
                commands: ['flauz.workflow.save', 'flauz.workflow.run', 'flauz.workflow.list'],
                wave: 'the TL3 workflow landing (the envelope store) + the C-lane cancellation rungs',
                gate: 'the flauz-workflow suite (112 tests at the F2b station receipt) + the C-WORKFLOW canary',
                supported: 'saving a run as a reusable workflow envelope, running it (with the pre-dispatch cancellation checkpoint + the stale-run typed unwind), and listing the banked envelopes.',
                unsupported: 'workflow runs execute task-shaped steps in the workspace (no remote/scheduled execution exists at this base); a cancelled run stays cancelled (no auto-resume; a fresh run is a fresh envelope execution); envelopes are workspace-local.',
        },
        // --- flauz-workspace (the TL4 IA shell owner + the workspace core) ---
        {
                id: 'workspace-views',
                owner: 'flauz-workspace',
                commands: ['flauz.focusView', 'flauz.focusView.home', 'flauz.focusView.tasks', 'flauz.workspace.refreshHome', 'flauz.workspace.refreshTasks', 'flauz.workspace.revealTask'],
                wave: 'the TL4-001 IA shell + the TL4-002 premium layer (last-known-good, reveal navigation, a11y grammar)',
                gate: 'the ia-gate + the premium-ux-gate (the PU rule families) + the flauz-workspace suite',
                supported: 'the Flauz shell views: focus/refresh across Home + Tasks, the row-level reveal navigation (session -> task -> evidence), error rows with Retry, ages + absolute UTC stamps.',
                unsupported: 'the views render durable state; they never mutate tasks or evidence (mutations route through the owning services); last-known-good keeps STALE rows only below a labeled error row (never silently fresh).',
        },
        {
                id: 'workspace-evidence',
                owner: 'flauz-workspace',
                commands: ['flauz.workspace.openEvidence'],
                wave: 'the TL4-001 IA shell (the evidence surface)',
                gate: 'the flauz-workspace suite + the ia-gate',
                supported: 'opens a ledger-referenced evidence artifact (uri-resolved from the evidence row).',
                unsupported: 'evidence opens READ-ONLY (the ledger is append-only; no view ever edits a row); artifacts outside the workspace root are not opened (the uri stays workspace-relative by law).',
        },
        {
                id: 'workspace-guide',
                owner: 'flauz-workspace',
                commands: ['flauz.workspace.openGuide'],
                wave: 'the TL4-002 premium layer (the docs surface v1)',
                gate: 'the premium-ux-gate (the error-row -> guide reachability rule)',
                supported: 'opens the shipped flauz-guide.md documentation surface, reachable from every error row.',
                unsupported: 'the guide is the SHIPPED document (no live docs fetch, no network); it documents the product as built at this base.',
        },
        // --- flauz-production (A-PROD-005-W1 -- this wave) ---
        {
                id: 'production-census',
                owner: 'flauz-production',
                commands: ['flauz.production.census'],
                wave: 'A-PROD-005-W1 (this wave) -- the runtime-installed-product census through the W5 product-root ports',
                gate: 'the flauz-production suite (the census semantics: installed-vs-repo parity, the typed degradations) + the DL-32 contract pins against the W5 seam',
                supported: 'the runtime-installed-product verification: the extension set the runtime actually loaded + the dist-tree manifests + the service-side parity/SBOM surfaces, verified against the repo-state product registry (five typed check classes green/tampered/torn); the record persisted workspace-locally + census-visible.',
                unsupported: 'where the runtime surface is ABSENT (no installed product -- the worker sandbox\'s honest state) the census DEGRADES TYPED, never silently green (the honest degradation is itself a certified behavior; the port is the seam a real install drives); the census enumerates shapes (ids, versions, verdicts, counts), never contents.',
        },
        {
                id: 'production-matrix',
                owner: 'flauz-production',
                commands: ['flauz.production.matrix'],
                wave: 'A-PROD-005-W1 (this wave) -- the documented supported/unsupported capabilities statement',
                gate: 'the flauz-production suite (the derivation + drift + honesty rows)',
                supported: 'the capability matrix derived from the REAL registry surfaces (the extension census + the parity rows + the contributed command ids): every capability\'s supported envelope + honest unsupported boundary, persisted machine-readable + rendered human-readable.',
                unsupported: 'the matrix DERIVES its row set from the live manifests -- it never invents a capability, and a command discovered in the product with no catalog entry is a typed UNKNOWN disclosure (the matrix refuses to guess a boundary it was never told); the matrix documents, it never certifies readiness (that is the gate\'s job).',
        },
        {
                id: 'production-gate',
                owner: 'flauz-production',
                commands: ['flauz.production.gate'],
                wave: 'A-PROD-005-W1 (this wave) -- the production-readiness verdict binding the ELEVEN prove-items',
                gate: 'the flauz-production suite (every prove-item\'s row class with single-row failure fixtures)',
                supported: 'the one-command production-readiness verdict: each prove-item row carries its evidence pointer (evaluated from the real surfaces at runtime when the surface exists), the not-yet rows name the owning later wave, and the verdict is GO-FOR-BETA / NOT-PRODUCTION-READY with the exact row-level truth.',
                unsupported: 'the gate NEVER silently greens a prove-item it cannot evidence (an absent surface is a DEGRADED row, a missing machinery is a NOT-YET row -- both hold the verdict at NOT-PRODUCTION-READY); the gate verifies and records, it never repairs, signs, isolates or supervises.',
        },
];

// ---------------------------------------------------------------------------
// The closure check (the catalog's own hygiene)
// ---------------------------------------------------------------------------

/** The catalog closure result. */
export interface CatalogClosure {
        readonly closed: boolean;
        readonly capabilityCount: number;
        readonly commandCount: number;
        readonly problems: readonly string[];
}

/**
 * The catalog hygiene check: unique capability ids, every command claimed by
 * EXACTLY one entry, every entry carries its owner/commands/wave/gate and
 * non-empty supported/unsupported statements (the honesty law's structural
 * half).
 */
export function catalogClosure(): CatalogClosure {
        const problems: string[] = [];
        const ids = new Set<string>();
        const claims = new Map<string, string>();
        for (const entry of CAPABILITY_CATALOG) {
                if (ids.has(entry.id)) {
                        problems.push(`duplicate capability id '${entry.id}'`);
                }
                ids.add(entry.id);
                if (entry.owner.length === 0 || !/^flauz-[a-z0-9-]+$/.test(entry.owner)) {
                        problems.push(`capability '${entry.id}' carries an invalid owner ${JSON.stringify(entry.owner)}`);
                }
                if (entry.wave.length === 0 || entry.gate.length === 0) {
                        problems.push(`capability '${entry.id}' is missing its wave/gate evidence class`);
                }
                if (entry.supported.length === 0 || entry.unsupported.length === 0) {
                        problems.push(`capability '${entry.id}' is missing its supported/unsupported statement`);
                }
                if (entry.commands.length === 0 && entry.id !== 'provider-lanes') {
                        problems.push(`capability '${entry.id}' claims no commands (only the state-side provider-lanes capability is legitimately commandless)`);
                }
                for (const command of entry.commands) {
                        const owner = claims.get(command);
                        if (owner !== undefined && owner !== entry.id) {
                                problems.push(`command '${command}' is claimed by both '${owner}' and '${entry.id}' (every command maps to exactly one capability)`);
                        }
                        claims.set(command, entry.id);
                }
        }
        return {
                closed: problems.length === 0,
                capabilityCount: CAPABILITY_CATALOG.length,
                commandCount: claims.size,
                problems,
        };
}
