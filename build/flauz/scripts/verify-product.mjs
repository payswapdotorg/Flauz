/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz — TL1-002 (product build/release shell). verify-product.mjs — the merged
// product posture gate. Runbook: build/flauz/RELEASE-SHELL.md.
//
// WHAT THIS GATE IS: it merges the REAL product.json + product.flauz.json via the
// mergeProduct API from build/flauz/merge-product.mjs (null-deletes semantics,
// DL-16) and asserts on the MERGED product — the posture a Flauz build would ship.
// It is the sibling of compat-battery.mjs's L2 product-identity rows: the battery
// diffs CONTRIBUTION SURFACES product-vs-upstream (identity set extracted from the
// overlay, compat-battery.mjs runLayer2ProductIdentity); this gate verifies the
// MERGED product itself. They cite each other; do not merge their jobs.
//
// Rules (TL1-002 work order, deliverable 2a-2d):
//   PS1 merge + validate : product.json + product.flauz.json strict-parse; the
//                          committed overlay passes validateOverlay (merge-product.mjs
//                          semantics); unknown overlay keys surface as WARN rows
//                          (DL-17: unknown keys are omitted, not guessed — the
//                          merger also warns on stderr).
//   PS2 identity         : merged nameShort/nameLong === "Flauz"; every
//                          identity-bearing SCALAR key (enumerated at runtime from
//                          the actual base product.json ∪ the overlay — never a
//                          hardcoded snapshot) must not name Microsoft/VS Code/
//                          Copilot products in its merged value, unless the key is
//                          in the documented exemption table below (proven inert
//                          or functional with citations).
//   PS3 copilot wiring   : defaultChatAgent ABSENT from the merged product (the
//                          null-delete must have landed — chatEntitlementService.ts:
//                          458-460 no-ops the whole Copilot stack without it);
//                          builtInExtensionsEnabledWithAutoUpdates EXISTS (scanner
//                          safety — extensionsScannerService.ts:113 iterates it
//                          unguarded) and names no copilot id; trustedExtensionAuthAccess
//                          grant lists name no copilot id.
//   PS4 proposals exact  : every extensions/flauz-*/package.json that declares
//                          enabledApiProposals (non-empty) is force-enabled EXACTLY
//                          under its "publisher.name" product key (the product list
//                          REPLACES the manifest declaration — extensionsProposedApi.ts:
//                          80-102; a declared-but-uncovered proposal is the runtime
//                          "WILL BE BROKEN" error at :91-97); extensions with empty
//                          lists get NO entry except the documented DL-4 default-
//                          participant grant for flauz.flauz-agent; every granted
//                          proposal must EXIST in the registry
//                          (src/vs/platform/extensions/common/extensionsApiProposals.ts
//                          — unknown names are silently dropped at
//                          extensionsProposedApi.ts:46-52, so a typo is NOT a
//                          force-enable); stale flauz.* grants for extensions that
//                          do not exist in the tree FAIL.
//   PS5 inclusion       : the REAL inclusion mechanism — upstream packaging globs
//                          extensions/*/package.json minus excludedExtensions minus
//                          names in product.json builtInExtensions
//                          (build/lib/extensions.ts:413-427), and the Flauz bundling
//                          step discovers extensions/flauz-*/src/extension.ts and
//                          builds dist/extension.js (bundle-extensions.mjs). The
//                          overlay deliberately sets NOTHING for inclusion (DL-17:
//                          no product key drives it — documented, not guessed). The
//                          gate asserts: every flauz dir has package.json AND
//                          src/extension.ts; each manifest's main is absent or
//                          "./dist/extension.js" (the hardcoded bundle outfile); no
//                          flauz name appears in merged builtInExtensions /
//                          webBuiltInExtensions (would EXCLUDE the local source per
//                          build/lib/extensions.ts:425); no flauz name appears in
//                          the excludedExtensions list parsed from build/lib/extensions.ts.
//
// Skip-vs-fail policy (build/flauz/README.md section 2): a tree without
// product.json or product.flauz.json SKIPs the whole gate with a recorded
// reason; a tree without flauz extensions SKIPs the PS4/PS5 extension rows.
// --require flips every SKIP to a failure (CI + fixture verification use it to
// prove the rules fire). --no-fail is report-only (exit 0 regardless).
//
// Usage:
//        node verify-product.mjs [--root <dir>] [--require] [--no-fail] [--json]
//        node verify-product.mjs --root test/fixtures/product-shell/clean --require
//
// Exit codes: 0 = clean (or documented SKIP) · 1 = product-shell violation ·
// 2 = usage error.
//
// Zero dependencies: node >= 20 stdlib only (imports the sibling merge-product.mjs).
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { mergeProduct, validateOverlay, KNOWN_OVERLAY_KEYS } from '../merge-product.mjs';

const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_USAGE = 2;

// Documented exemptions for the PS2 branding sweep: keys whose merged values may
// reference Microsoft/VS Code surfaces because they are proven inert or functional
// (citations live with each entry; the full rationale is in RELEASE-SHELL.md).
export const BRANDING_EXEMPTIONS = new Map([
        ['licenseUrl', 'MIT attribution of the Code OSS derivative — the in-tree LICENSE.txt IS the upstream MIT license; pointing the license link at it is legally correct attribution, not branding.'],
        ['serverLicenseUrl', 'Same MIT-attribution rationale as licenseUrl (server variant).'],
        ['webviewContentExternalBaseUrlTemplate', 'Commit-pinned webview asset CDN (functional infrastructure serving the exact prebuilt webview assets the base ships; not user-facing branding).'],
        ['voiceWsUrl', 'Voice/dictation service endpoint (functional external service; removing it would disable a Code OSS capability — ARCHITECTURE-LOCK section 2 Pillar 1).'],
]);

// Deny patterns for the PS2 sweep: a merged identity value matching any of these
// names a Microsoft/VS Code/Copilot product.
const BRANDING_PATTERNS = [
        /microsoft/i,
        /visual\s*studio/i,
        /vscode/i,
        /code[\s-]?oss/i,
        /\boss\b/i,
        /copilot/i,
];

// Documented DL-4 grant: the ONLY allowed product-proposal entry for a flauz
// extension whose manifest declares NO proposals. flauz-agent's statically
// contributed isDefault chat participant parses only under these proposals
// (src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts:268-276;
// canaries/default-agent-checklist.md D2; README.md Appendix Lane F).
export const DOCUMENTED_EMPTY_MANIFEST_GRANTS = new Map([
        ['flauz.flauz-agent', ['defaultChatParticipant', 'chatParticipantAdditions']],
]);

const REGISTRY_REL = path.join('src', 'vs', 'platform', 'extensions', 'common', 'extensionsApiProposals.ts');
const EXTENSIONS_LIB_REL = path.join('build', 'lib', 'extensions.ts');

function usage() {
        process.stdout.write(`verify-product.mjs — merged product posture gate (TL1-002)

Usage:
        node verify-product.mjs [--root <dir>] [--require] [--no-fail] [--json]
        node verify-product.mjs --root test/fixtures/product-shell/clean --require

Options:
        --root <dir>   root dir holding product.json + product.flauz.json (default: cwd)
        --require      fail when the product shell or any rule input is missing
                       (flips every documented SKIP to a failure — CI/fixture mode)
        --no-fail      report-only: always exit 0, violations still listed
        --json         machine-readable single-object report on stdout
        -h, --help     show this help

Rules: PS1 merge+validateOverlay (DL-17 unknown-key WARN) · PS2 identity
(nameShort/nameLong "Flauz" + runtime-enumerated branding sweep with documented
exemptions) · PS3 Copilot wiring (defaultChatAgent absent; no copilot ids in
auto-update/auth grants; scanner-safety key present) · PS4 proposals exact
(manifest-declared set == product set; documented DL-4 grant only; registry
existence; no stale/invented entries) · PS5 inclusion posture (the REAL
mechanisms: build/lib/extensions.ts glob+exclusions+builtInExtensions and
bundle-extensions.mjs src/extension.ts discovery + dist main convention).

Exit codes: 0 clean/SKIP · 1 violation · 2 usage error.
`);
}

function isPlainObject(value) {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonFileStrict(filePath) {
        let raw;
        try {
                raw = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
                throw new Error(`cannot read ${filePath}: ${err.message}`);
        }
        if (raw.charCodeAt(0) === 0xFEFF) {
                throw new Error(`${filePath} must not start with a UTF-8 BOM (strict JSON)`);
        }
        try {
                return JSON.parse(raw);
        } catch (err) {
                throw new Error(`${filePath} is not strict JSON (comments, trailing commas, and BOMs are rejected): ${err.message}`);
        }
}

/** Directory scan of extensions/flauz-* — the same discovery shape as
 *  bundle-extensions.mjs (never a hardcoded list). */
function discoverFlauzExtensions(root) {
        const extRoot = path.join(root, 'extensions');
        let names;
        try {
                names = fs.readdirSync(extRoot);
        } catch {
                return [];
        }
        return names
                .filter(n => n.startsWith('flauz-'))
                .map(n => {
                        const dir = path.join(extRoot, n);
                        return {
                                dirName: n,
                                dir,
                                hasManifest: fs.existsSync(path.join(dir, 'package.json')),
                                hasEntry: fs.existsSync(path.join(dir, 'src', 'extension.ts')),
                        };
                });
}

/** Parse the proposal registry (generated TS object literal): keys of
 *  _allApiProposals. Returns null when the file is absent, [] when present but
 *  unparseable (the caller turns that into a SKIP-with-reason). */
function parseProposalRegistry(root) {
        const file = path.join(root, ...REGISTRY_REL.split(path.sep));
        let text;
        try {
                text = fs.readFileSync(file, 'utf8');
        } catch {
                return null;
        }
        const start = text.indexOf('const _allApiProposals = {');
        if (start === -1) {
                return [];
        }
        const end = text.indexOf('\n};', start);
        const span = end === -1 ? text.slice(start) : text.slice(start, end);
        return [...span.matchAll(/^\t([A-Za-z0-9_]+): \{$/gm)].map(m => m[1]);
}

/** Parse the excludedExtensions list from build/lib/extensions.ts. Returns
 *  null when the file is absent (fixture trees may omit it). */
function parseExcludedExtensions(root) {
        const file = path.join(root, ...EXTENSIONS_LIB_REL.split(path.sep));
        let text;
        try {
                text = fs.readFileSync(file, 'utf8');
        } catch {
                return null;
        }
        const m = /const excludedExtensions = \[([^\]]*)\]/.exec(text);
        if (!m) {
                return [];
        }
        return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
}

function setEquals(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
                return false;
        }
        const sa = [...a].sort();
        const sb = [...b].sort();
        return sa.every((v, i) => v === sb[i]);
}

/** Lowercased "publisher.name" key, matching ExtensionIdentifier.toKey semantics
 *  (extensionsProposedApi.ts:45 — keys are case-insensitive at runtime). */
function extensionProductKey(pkg) {
        const publisher = typeof pkg.publisher === 'string' && pkg.publisher.length > 0 ? pkg.publisher : '<no-publisher>';
        const name = typeof pkg.name === 'string' && pkg.name.length > 0 ? pkg.name : '<no-name>';
        return `${publisher}.${name}`.toLowerCase();
}

export function analyzeProductShell(root) {
        const rows = [];
        let violations = 0;
        let skips = 0;
        const row = (status, rule, message) => {
                rows.push({ status, rule, message });
                if (status === 'FAIL') {
                        violations++;
                } else if (status === 'SKIP') {
                        skips++;
                }
        };

        const baseProductPath = path.join(root, 'product.json');
        const overlayPath = path.join(root, 'product.flauz.json');

        if (!fs.existsSync(baseProductPath) || !fs.existsSync(overlayPath)) {
                return {
                        verdict: 'SKIP',
                        skipReason: `product shell not present under ${root} (need both product.json and product.flauz.json — documented SKIP; verify-product deferred)`,
                        rows,
                        violations,
                        skips,
                        merged: null,
                };
        }

        // ---- PS1: strict parse + validateOverlay + merge (via the real API) --------
        let base, overlay;
        try {
                base = parseJsonFileStrict(baseProductPath);
                if (!isPlainObject(base)) {
                        throw new Error(`${baseProductPath} must contain a JSON object at the top level`);
                }
        } catch (err) {
                row('FAIL', 'PS1', `product.json does not parse: ${err.message}`);
                return { verdict: 'VIOLATIONS', skipReason: null, rows, violations, skips, merged: null };
        }
        try {
                overlay = parseJsonFileStrict(overlayPath);
        } catch (err) {
                row('FAIL', 'PS1', `product.flauz.json does not parse: ${err.message}`);
                return { verdict: 'VIOLATIONS', skipReason: null, rows, violations, skips, merged: null };
        }

        let merged;
        try {
                merged = mergeProduct(base, overlay, { overlayName: 'product.flauz.json' });
        } catch (err) {
                row('FAIL', 'PS1', `validateOverlay rejected the committed overlay: ${err instanceof Error ? err.message : String(err)}`);
                return { verdict: 'VIOLATIONS', skipReason: null, rows, violations, skips, merged: null };
        }
        row('PASS', 'PS1', `product.json + product.flauz.json merged via mergeProduct (${Object.keys(base).length} base keys, ${Object.keys(overlay).length} overlay keys, ${Object.keys(merged).length} merged keys); validateOverlay passed.`);

        for (const key of Object.keys(overlay)) {
                if (!KNOWN_OVERLAY_KEYS.includes(key)) {
                        row('WARN', 'PS1', `overlay sets unknown key "${key}" — no IProductConfiguration consumer at the pinned base (DL-17: unknown keys are omitted, not guessed; verify before relying on it).`);
                }
        }

        // ---- PS2: identity ---------------------------------------------------------
        if (merged.nameShort === 'Flauz' && merged.nameLong === 'Flauz') {
                row('PASS', 'PS2', 'identity: merged nameShort/nameLong are "Flauz".');
        } else {
                row('FAIL', 'PS2', `identity: merged nameShort=${JSON.stringify(merged.nameShort)}, nameLong=${JSON.stringify(merged.nameLong)} — both must be "Flauz".`);
        }

        // Branding sweep: every SCALAR string key of the actual base ∪ the overlay
        // (runtime enumeration — a new upstream identity key lands in the sweep
        // automatically), checked against the merged value.
        const sweepKeys = new Set([...Object.keys(base), ...Object.keys(overlay)]);
        let sweepHits = 0;
        for (const key of [...sweepKeys].sort()) {
                if (!(key in merged) || typeof merged[key] !== 'string') {
                        continue; // deleted by the overlay, or not a scalar string
                }
                const value = merged[key];
                const hit = BRANDING_PATTERNS.find(re => re.test(value));
                if (!hit) {
                        continue;
                }
                const exemption = BRANDING_EXEMPTIONS.get(key);
                if (exemption) {
                        row('PASS', 'PS2', `branding sweep: "${key}" keeps a Microsoft/VS Code reference — documented exemption (${exemption})`);
                } else {
                        sweepHits++;
                        row('FAIL', 'PS2', `branding sweep: merged "${key}" = ${JSON.stringify(value)} names a Microsoft/VS Code product (pattern /${hit.source}/i) — rebrand it in product.flauz.json or prove it inert with a documented exemption.`);
                }
        }
        if (sweepHits === 0) {
                row('PASS', 'PS2', `branding sweep: ${[...sweepKeys].filter(k => k in merged && typeof merged[k] === 'string').length} scalar product key(s) carry no Microsoft/VS Code branding (exemptions: ${[...BRANDING_EXEMPTIONS.keys()].join(', ')}).`);
        }

        // ---- PS3: copilot wiring ---------------------------------------------------
        if ('defaultChatAgent' in merged) {
                row('FAIL', 'PS3', 'merged product still carries defaultChatAgent — the overlay null-delete (DL-16) was lost; the Copilot setup/entitlement stack would boot (chatEntitlementService.ts:458-460).');
        } else {
                row('PASS', 'PS3', 'defaultChatAgent is ABSENT from the merged product (DL-16 null-delete landed — the Copilot setup/entitlement stack no-ops).');
        }

        if (!('builtInExtensionsEnabledWithAutoUpdates' in merged)) {
                row('FAIL', 'PS3', 'merged product lacks builtInExtensionsEnabledWithAutoUpdates — the extension scanner iterates it unguarded (extensionsScannerService.ts:113; typed non-optional at product.ts:258) and would crash. Keep the key (the overlay clears the Copilot residue with [], never null).');
        } else {
                const list = merged.builtInExtensionsEnabledWithAutoUpdates;
                const copilotIds = Array.isArray(list) ? list.filter(id => /copilot/i.test(String(id))) : [];
                if (!Array.isArray(list)) {
                        row('FAIL', 'PS3', `builtInExtensionsEnabledWithAutoUpdates must be an array (got ${typeof list}).`);
                } else if (copilotIds.length > 0) {
                        row('FAIL', 'PS3', `builtInExtensionsEnabledWithAutoUpdates still names Copilot extension(s): ${copilotIds.join(', ')} — inert residue; clear it to [] in the overlay.`);
                } else {
                        row('PASS', 'PS3', `builtInExtensionsEnabledWithAutoUpdates present and Copilot-free (${list.length} id(s)) — scanner-safe.`);
                }
        }

        const grants = merged.trustedExtensionAuthAccess;
        if (isPlainObject(grants)) {
                const copilotGrants = [];
                for (const [provider, ids] of Object.entries(grants)) {
                        if (Array.isArray(ids)) {
                                for (const id of ids) {
                                        if (/copilot/i.test(String(id))) {
                                                copilotGrants.push(`${provider}: ${id}`);
                                        }
                                }
                        }
                }
                if (copilotGrants.length > 0) {
                        row('FAIL', 'PS3', `trustedExtensionAuthAccess still grants Copilot extension(s): ${copilotGrants.join('; ')} — null-delete those provider entries in the overlay (all consumers are guarded).`);
                } else {
                        row('PASS', 'PS3', `trustedExtensionAuthAccess grant lists are Copilot-free (${Object.keys(grants).join(', ')}).`);
                }
        } else if (grants === undefined) {
                row('PASS', 'PS3', 'trustedExtensionAuthAccess absent from the merged product (nothing to sweep).');
        } else {
                row('FAIL', 'PS3', `trustedExtensionAuthAccess must be an object when present (got ${typeof grants}).`);
        }

        // ---- PS4: proposals exact --------------------------------------------------
        const extensions = discoverFlauzExtensions(root);
        const registry = parseProposalRegistry(root);
        if (extensions.length === 0) {
                row('SKIP', 'PS4', 'no extensions/flauz-* directories found — proposal posture has nothing to check in this tree (documented SKIP).');
        } else {
                const productProposals = merged.extensionEnabledApiProposals;
                const productMap = new Map(); // lowercased key -> { originalKey, proposals }
                if (isPlainObject(productProposals)) {
                        for (const [k, v] of Object.entries(productProposals)) {
                                productMap.set(k.toLowerCase(), { originalKey: k, proposals: Array.isArray(v) ? v : [] });
                        }
                }

                const manifestKeys = new Set();
                for (const ext of extensions) {
                        if (!ext.hasManifest) {
                                continue; // PS5 reports the missing manifest
                        }
                        let pkg;
                        try {
                                pkg = JSON.parse(fs.readFileSync(path.join(ext.dir, 'package.json'), 'utf8'));
                        } catch (err) {
                                row('FAIL', 'PS4', `extensions/${ext.dirName}/package.json is not valid JSON — ${err.message}`);
                                continue;
                        }
                        const key = extensionProductKey(pkg);
                        manifestKeys.add(key);
                        const declared = Array.isArray(pkg.enabledApiProposals) ? pkg.enabledApiProposals.filter(p => typeof p === 'string') : [];

                        if (declared.length > 0) {
                                const entry = productMap.get(key);
                                if (!entry) {
                                        row('FAIL', 'PS4', `extensions/${ext.dirName} declares enabledApiProposals [${declared.join(', ')}] but the merged product has no "${key}" entry — the product list REPLACES the manifest declaration (extensionsProposedApi.ts:80-102) and the extension WILL BE BROKEN at runtime (:91-97).`);
                                } else if (!setEquals(entry.proposals, declared)) {
                                        const missing = declared.filter(p => !entry.proposals.includes(p));
                                        const extra = entry.proposals.filter(p => !declared.includes(p));
                                        row('FAIL', 'PS4', `"${key}" must force-enable exactly the manifest set [${declared.join(', ')}] — merged grants [${entry.proposals.join(', ') || '<empty>'}]${missing.length ? `; missing: ${missing.join(', ')}` : ''}${extra.length ? `; undeclared: ${extra.join(', ')}` : ''}.`);
                                } else {
                                        row('PASS', 'PS4', `"${key}" force-enables exactly the manifest-declared proposals [${declared.join(', ')}].`);
                                }
                        } else {
                                const entry = productMap.get(key);
                                if (!entry) {
                                        row('PASS', 'PS4', `"${key}" declares no proposals and gets no product entry (nothing invented).`);
                                } else {
                                        const blessed = DOCUMENTED_EMPTY_MANIFEST_GRANTS.get(key);
                                        if (blessed && setEquals(entry.proposals, blessed)) {
                                                row('PASS', 'PS4', `"${key}" carries the documented DL-4 default-participant grant [${blessed.join(', ')}] (chatParticipant.contribution.ts:268-276; canaries/default-agent-checklist.md D2).`);
                                        } else {
                                                row('FAIL', 'PS4', `"${key}" declares NO proposals but the merged product grants [${entry.proposals.join(', ')}] — an undeclared grant${blessed ? ` (the documented pattern is [${blessed.join(', ')}])` : ''}. Remove it, or document it with in-tree citations like the DL-4 flauz-agent grant.`);
                                        }
                                }
                        }
                }

                // stale entries: flauz-published grants with no corresponding extension
                for (const [key, entry] of productMap) {
                        if (!key.startsWith('flauz.')) {
                                continue; // not our namespace (a future base may ship its own entries)
                        }
                        if (!manifestKeys.has(key)) {
                                row('FAIL', 'PS4', `"${entry.originalKey}" grants proposals but no extensions/flauz-* manifest in this tree declares that identity — stale entry; remove it from the overlay.`);
                        }
                }

                // registry existence: a typo'd proposal is silently DROPPED at runtime
                if (registry === null) {
                        row('SKIP', 'PS4', `${REGISTRY_REL} not found under the root — proposal-existence check deferred (documented SKIP; the real tree carries the registry).`);
                } else if (registry.length === 0) {
                        row('SKIP', 'PS4', `${REGISTRY_REL} present but no proposals parsed — proposal-existence check deferred (unparseable registry).`);
                } else {
                        const unknown = [];
                        for (const [, entry] of productMap) {
                                for (const p of entry.proposals) {
                                        if (!registry.includes(p)) {
                                                unknown.push(`${entry.originalKey}: ${p}`);
                                        }
                                }
                        }
                        if (unknown.length > 0) {
                                row('FAIL', 'PS4', `unknown proposal name(s) granted: ${unknown.join('; ')} — extensionsProposedApi.ts:46-52 DROPS them with a warning, so they are NOT force-enabled (check the registry ${REGISTRY_REL}).`);
                        } else {
                                row('PASS', 'PS4', `all granted proposals exist in the registry (${registry.length} proposals at ${REGISTRY_REL}).`);
                        }
                }
        }

        // ---- PS5: inclusion posture (the REAL mechanism) ---------------------------
        if (extensions.length === 0) {
                row('SKIP', 'PS5', 'no extensions/flauz-* directories found — inclusion posture has nothing to check in this tree (documented SKIP).');
        } else {
                for (const ext of extensions) {
                        if (!ext.hasManifest) {
                                row('FAIL', 'PS5', `extensions/${ext.dirName} has no package.json — invisible to the packaging glob extensions/*/package.json (build/lib/extensions.ts:416); the extension would NOT ship.`);
                        }
                        if (!ext.hasEntry) {
                                row('FAIL', 'PS5', `extensions/${ext.dirName} has no src/extension.ts — invisible to bundle-extensions.mjs discovery (scripts line: extensions/flauz-*/src/extension.ts); the dist bundle would NOT build.`);
                        }
                        if (ext.hasManifest) {
                                try {
                                        const pkg = JSON.parse(fs.readFileSync(path.join(ext.dir, 'package.json'), 'utf8'));
                                        const main = pkg.main;
                                        if (main === undefined || main === './dist/extension.js') {
                                                row('PASS', 'PS5', `extensions/${ext.dirName}: main ${main ?? '(default ./dist/extension.js)'} matches the bundle-extensions output convention.`);
                                        } else {
                                                row('FAIL', 'PS5', `extensions/${ext.dirName}: main ${JSON.stringify(main)} — bundle-extensions.mjs hardcodes the outfile extensions/flauz-*/dist/extension.js and --verify checks main against it; a different main breaks the build/verify chain.`);
                                        }
                                } catch {
                                        // PS4 already reported the parse failure
                                }
                        }
                }

                for (const listKey of ['builtInExtensions', 'webBuiltInExtensions']) {
                        const list = merged[listKey];
                        if (!Array.isArray(list)) {
                                continue;
                        }
                        const hits = list
                                .map(e => (isPlainObject(e) && typeof e.name === 'string' ? e.name : null))
                                .filter(n => n !== null && n.toLowerCase().startsWith('flauz-'));
                        if (hits.length > 0) {
                                row('FAIL', 'PS5', `merged ${listKey} lists flauz extension name(s) ${hits.join(', ')} — build/lib/extensions.ts:425 EXCLUDES builtInExtensions names from local-source packaging (they would be treated as marketplace-fetched instead); flauz built-ins live in the tree, not in that list.`);
                        }
                }
                const withProductLists = ['builtInExtensions', 'webBuiltInExtensions'].filter(k => Array.isArray(merged[k]));
                if (withProductLists.length > 0) {
                        row('PASS', 'PS5', `no flauz name in merged ${withProductLists.join(' / ')} — local-source packaging is not excluded (build/lib/extensions.ts:425).`);
                }

                const excluded = parseExcludedExtensions(root);
                if (excluded === null) {
                        row('SKIP', 'PS5', `${EXTENSIONS_LIB_REL} not found under the root — excludedExtensions check deferred (documented SKIP; the real tree carries the list).`);
                } else {
                        const hits = excluded.filter(n => n.toLowerCase().startsWith('flauz-'));
                        if (hits.length > 0) {
                                row('FAIL', 'PS5', `build/lib/extensions.ts excludedExtensions lists ${hits.join(', ')} — excluded local extensions are not packaged (build/lib/extensions.ts:318-326/424); flauz built-ins must never be excluded.`);
                        } else {
                                row('PASS', 'PS5', `no flauz name in the excludedExtensions list (${excluded.length} entries parsed from ${EXTENSIONS_LIB_REL}).`);
                        }
                }
        }

        return {
                verdict: violations > 0 ? 'VIOLATIONS' : 'CLEAN',
                skipReason: null,
                rows,
                violations,
                skips,
                merged: {
                        nameShort: merged.nameShort,
                        nameLong: merged.nameLong,
                        applicationName: merged.applicationName,
                        keys: Object.keys(merged).length,
                        hasDefaultChatAgent: 'defaultChatAgent' in merged,
                        proposalEntries: isPlainObject(merged.extensionEnabledApiProposals) ? Object.keys(merged.extensionEnabledApiProposals) : [],
                },
        };
}

function main() {
        let parsed;
        try {
                parsed = parseArgs({
                        allowPositionals: false,
                        options: {
                                root: { type: 'string', default: process.cwd() },
                                require: { type: 'boolean', default: false },
                                'no-fail': { type: 'boolean', default: false },
                                json: { type: 'boolean', default: false },
                                help: { type: 'boolean', default: false, short: 'h' },
                        },
                });
        } catch (e) {
                process.stderr.write(`usage error: ${e.message}\n\n`);
                usage();
                process.exit(EXIT_USAGE);
        }
        const args = parsed.values;
        if (args.help) {
                usage();
                process.exit(EXIT_OK);
        }
        if (args.require && args['no-fail']) {
                process.stderr.write('usage error: --require and --no-fail are mutually exclusive\n\n');
                usage();
                process.exit(EXIT_USAGE);
        }

        const root = path.resolve(args.root);
        const result = analyzeProductShell(root);

        // --require flips every documented SKIP to a failure (CI / fixture mode).
        if (args.require && result.verdict === 'SKIP') {
                result.rows.push({ status: 'FAIL', rule: 'GATE', message: `--require: ${result.skipReason}` });
                result.violations++;
                result.verdict = 'VIOLATIONS';
                result.skipReason = null;
        } else if (args.require && result.verdict === 'CLEAN' && result.skips > 0) {
                for (const r of result.rows) {
                        if (r.status === 'SKIP') {
                                r.status = 'FAIL';
                                r.message = `--require: ${r.message}`;
                                result.violations++;
                        }
                }
                result.verdict = 'VIOLATIONS';
        }

        if (args.json) {
                const counts = {
                        pass: result.rows.filter(r => r.status === 'PASS').length,
                        fail: result.rows.filter(r => r.status === 'FAIL').length,
                        warn: result.rows.filter(r => r.status === 'WARN').length,
                        skip: result.rows.filter(r => r.status === 'SKIP').length,
                };
                process.stdout.write(JSON.stringify({
                        gate: 'verify-product',
                        root,
                        verdict: result.verdict,
                        skipReason: result.skipReason,
                        counts,
                        rows: result.rows,
                        merged: result.merged,
                }, null, '\t') + '\n');
        } else {
                if (result.verdict === 'SKIP') {
                        process.stdout.write(`SKIP  ${result.skipReason}\n`);
                        process.stdout.write('verify-product: SKIP (documented; product shell not present in this tree)\n');
                } else {
                        for (const r of result.rows) {
                                process.stdout.write(`${r.status}  ${r.rule}  ${r.message}\n`);
                        }
                        if (result.verdict === 'CLEAN') {
                                process.stdout.write(`verify-product: CLEAN (${result.rows.filter(r => r.status === 'PASS').length} pass, ${result.rows.filter(r => r.status === 'WARN').length} warn, ${result.rows.filter(r => r.status === 'SKIP').length} skip)\n`);
                        } else {
                                process.stdout.write(`verify-product: product-shell violations found (${result.violations} FAIL row(s) — see above)\n`);
                        }
                }
        }

        if (args['no-fail']) {
                process.exit(EXIT_OK);
        }
        process.exit(result.verdict === 'CLEAN' || result.verdict === 'SKIP' ? EXIT_OK : EXIT_FAIL);
}

// Exported for verify-product.test.mjs; the CLI path only runs when executed
// directly (same guard pattern as merge-product.mjs).
const invokedAsCli = process.argv[1]
        && (import.meta.url.endsWith('verify-product.mjs') && process.argv[1].endsWith('verify-product.mjs'));

if (invokedAsCli) {
        main();
}
