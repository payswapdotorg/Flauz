/* ------------------------------------------------------------------ */
/* Flauz Capability Exchange - CR-006 registry runtime test battery.  */
/*                                                                     */
/* MIT License - see registry.mjs for the full header box.            */
/* Copyright (c) Flauz contributors.                                   */
/* ------------------------------------------------------------------ */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRegistry } from "./registry.mjs";
import type { RegistryRuntime } from "./registry.mjs";
import * as machine from "./state.mjs";

import { PACK_ARTIFACT_KINDS, PACK_PERMISSION_IDS, PERMISSION_RISK_TIERS, PACK_PLATFORMS } from "../packs/common/pack.ts";
import { VERIFICATION_STATUSES as CONTRACT_VERIFICATION_STATUSES } from "../packs/common/verification.ts";
import { SOURCE_KINDS as CONTRACT_SOURCE_KINDS } from "../sources/common/source.ts";
import { IMPORT_STATES, CAPABILITY_PERMISSIONS, IMPORTED_ENTRY_VERIFICATION_STATUSES } from "../sources/common/import.ts";

function mustOk<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
        if (outcome.ok) {
                return outcome as Extract<T, { ok: true }>;
        }
        assert.fail("expected an ok outcome, received refusal: " + JSON.stringify(outcome));
}

function mustRefuse<T extends { ok: boolean }>(outcome: T): { code: string; law: string; entryId?: string; state?: string; detail: string } {
        if (!outcome.ok) {
                return (outcome as unknown as { refusal: { code: string; law: string; entryId?: string; state?: string; detail: string } }).refusal;
        }
        assert.fail("expected a refusal, received an ok outcome");
}

function granted(result: machine.TransitionResult): Extract<machine.TransitionResult, { ok: true }> {
        if (result.ok) {
                return result;
        }
        assert.fail("expected a grant, received refusal " + result.refusal.code);
}

function refusedMachine(result: machine.TransitionResult): machine.Refusal {
        if (!result.ok) {
                return result.refusal;
        }
        assert.fail("expected a refusal, received a grant");
}

function makeClock(): { clock: () => number; advance: (step?: number) => void } {
        let now = 1000;
        return { clock: () => now, advance: (step = 1) => { now += step; } };
}

function makeMemoryFs() {
        const files = new Map<string, string>();
        const enoent = (path: string): Error => {
                const err = new Error("ENOENT: no such file or directory, open '" + path + "'");
                (err as NodeJS.ErrnoException).code = "ENOENT";
                return err;
        };
        return {
                files,
                async readFile(path: string): Promise<string> {
                        const text = files.get(path);
                        if (text === undefined) {
                                throw enoent(path);
                        }
                        return text;
                },
                async writeFile(path: string, text: string): Promise<void> {
                        files.set(path, text);
                },
                async appendFile(path: string, text: string): Promise<void> {
                        files.set(path, (files.get(path) ?? "") + text);
                },
                async mkdir(): Promise<void> {},
                async readdir(path: string): Promise<string[]> {
                        return [...files.keys()].filter((key) => key.startsWith(path + "/")).map((key) => key.slice(path.length + 1));
                }
        };
}

const realFsPort = {
        readFile: (path: string, encoding: "utf8") => fsp.readFile(path, encoding),
        writeFile: (path: string, text: string) => fsp.writeFile(path, text),
        appendFile: (path: string, text: string) => fsp.appendFile(path, text),
        mkdir: async (path: string, options: { recursive: boolean }) => {
                await fsp.mkdir(path, options);
        },
        readdir: (path: string) => fsp.readdir(path)
};

const SCOPED = { workspaceId: "ws-1", tenantId: "tenant-1" };

async function makeRegistry(): Promise<{ registry: RegistryRuntime; files: Map<string, string>; clock: () => number }> {
        const fs = makeMemoryFs();
        const { clock } = makeClock();
        const registry = createRegistry({ root: "/reg", clock, fsPort: fs, scope: SCOPED });
        const loaded = mustOk(await registry.load());
        assert.equal(loaded.seq, 0);
        assert.equal(loaded.entries, 0);
        return { registry, files: fs.files, clock };
}

const DISCOVERY = { sourceKind: "community-project", artifactKind: "cli", version: "1.0.0", contentHash: "a".repeat(64), name: "demo-capability" };
const IMPORTED = {
        digest: "a".repeat(64),
        version: "1.0.0",
        license: "MIT",
        permissions: ["read-files"],
        endpoints: ["https://example.com/demo"],
        platforms: ["linux-x64"],
        artifactKind: "cli",
        provenance: { origin: "community-project" }
};
const APPROVAL = { approver: "operator-1", acknowledgedPermissions: ["read-files"] };

function receiptOf(status: string) {
        return { verificationStatus: status, checks: [{ check: "digest", outcome: "match" }] };
}

async function discoverImported(registry: RegistryRuntime): Promise<string> {
        mustOk(await registry.discover(DISCOVERY));
        const registered = mustOk(await registry.register(IMPORTED));
        return registered.entryId;
}

async function verifiedEntry(registry: RegistryRuntime): Promise<string> {
        const entryId = await discoverImported(registry);
        mustOk(await registry.verify(entryId, receiptOf("verified")));
        return entryId;
}

async function approvedEntry(registry: RegistryRuntime): Promise<string> {
        const entryId = await verifiedEntry(registry);
        mustOk(await registry.approve(entryId, APPROVAL));
        return entryId;
}

async function enabledEntry(registry: RegistryRuntime): Promise<string> {
        const entryId = await approvedEntry(registry);
        mustOk(await registry.enable(entryId));
        return entryId;
}

async function runScenario(): Promise<{ journal: string; snapshot: string }> {
        const fs = makeMemoryFs();
        const { clock } = makeClock();
        const registry = createRegistry({ root: "/reg", clock, fsPort: fs, scope: SCOPED });
        mustOk(await registry.load());
        const entryId = await enabledEntry(registry);
        mustOk(await registry.projectAvailability(entryId, { platformMatch: false, dependenciesPresent: true }));
        mustOk(await registry.projectAvailability(entryId, { platformMatch: true, dependenciesPresent: true }));
        mustOk(await registry.update(entryId, { ...IMPORTED, version: "2.0.0", digest: "d".repeat(64) }));
        return { journal: fs.files.get("/reg/registry-journal.jsonl") ?? "", snapshot: fs.files.get("/reg/registry-state.json") ?? "" };
}

suite("CR-006 capability registry", () => {

        suite("vocabulary cross-pins against the ZC contracts", () => {
                const listsEqualBothWays = (a: readonly string[], b: readonly string[]) => {
                        assert.deepEqual([...a], [...b]);
                        assert.deepEqual([...b], [...a]);
                };
                test("artifact kinds equal PACK_ARTIFACT_KINDS both directions", () => {
                        listsEqualBothWays(machine.ARTIFACT_KINDS, PACK_ARTIFACT_KINDS);
                });
                test("verification statuses equal the contract statuses both directions", () => {
                        listsEqualBothWays(machine.VERIFICATION_STATUSES, CONTRACT_VERIFICATION_STATUSES);
                        listsEqualBothWays(machine.VERIFICATION_STATUSES, IMPORTED_ENTRY_VERIFICATION_STATUSES);
                });
                test("source kinds equal the nine contract kinds both directions", () => {
                        listsEqualBothWays(machine.SOURCE_KINDS, CONTRACT_SOURCE_KINDS);
                        assert.equal(machine.SOURCE_KINDS.length, 9);
                });
                test("permission ids equal PACK_PERMISSION_IDS and CAPABILITY_PERMISSIONS both directions", () => {
                        listsEqualBothWays(machine.PERMISSION_IDS, PACK_PERMISSION_IDS);
                        listsEqualBothWays(machine.PERMISSION_IDS, CAPABILITY_PERMISSIONS);
                });
                test("risk tiers equal PERMISSION_RISK_TIERS both directions", () => {
                        listsEqualBothWays(machine.RISK_TIERS, PERMISSION_RISK_TIERS);
                });
                test("platforms equal PACK_PLATFORMS both directions", () => {
                        listsEqualBothWays(machine.PLATFORMS, PACK_PLATFORMS);
                });
                test("the import chain equals IMPORT_STATES both directions", () => {
                        listsEqualBothWays(machine.IMPORT_CHAIN, IMPORT_STATES);
                });
                test("the registry lifecycle is the eight frozen states", () => {
                        assert.deepEqual([...machine.REGISTRY_STATES], ["discovered", "imported", "verified", "approved", "enabled", "available", "unavailable", "revoked"]);
                        assert.equal(machine.REGISTRY_STATES.length, 8);
                        assert.ok(Object.isFrozen(machine.REGISTRY_STATES));
                });
                test("the operation surface is the eleven ruled operations", () => {
                        assert.deepEqual([...machine.REGISTRY_OPS], ["discover", "inspect", "compare", "verify", "approve", "register", "enable", "disable", "update", "remove", "query"]);
                });
                test("every frozen refusal carries a code and a law, and the vocabularies are frozen", () => {
                        const refusals = machine.REFUSALS as Record<string, { code: string; law: string }>;
                        for (const code of Object.keys(refusals)) {
                                assert.equal(refusals[code].code, code);
                                assert.ok(refusals[code].law.length > 0);
                        }
                        assert.ok(Object.isFrozen(machine.REFUSALS));
                        assert.ok(Object.isFrozen(machine.PERMISSION_IDS));
                        assert.ok(Object.isFrozen(machine.SOURCE_KINDS));
                });
        });

        suite("pure state machine: the transition matrix", () => {
                test("register advances discovered -> imported", () => {
                        assert.equal(granted(machine.applyTransition("discovered", "register", IMPORTED)).nextState, "imported");
                });
                test("a verified receipt advances imported -> verified", () => {
                        assert.equal(granted(machine.applyTransition("imported", "verify", receiptOf("verified"))).nextState, "verified");
                });
                test("a verification-failed receipt advances imported -> unavailable with the typed cause", () => {
                        const result = granted(machine.applyTransition("imported", "verify", receiptOf("verification-failed")));
                        assert.equal(result.nextState, "unavailable");
                        assert.equal(result.cause, "verification-failed");
                });
                test("a verified-partial receipt is a non-advancing disclosure", () => {
                        const result = granted(machine.applyTransition("imported", "verify", receiptOf("verified-partial")));
                        assert.equal(result.nextState, "imported");
                        const disclosure = result.disclosure;
                        assert.ok(disclosure !== undefined && disclosure !== null);
                        assert.equal(disclosure.code, "D_VERIFICATION_PARTIAL");
                });
                test("approve advances verified -> approved", () => {
                        assert.equal(granted(machine.applyTransition("verified", "approve", APPROVAL)).nextState, "approved");
                });
                test("enable advances approved -> enabled", () => {
                        assert.equal(granted(machine.applyTransition("approved", "enable", {})).nextState, "enabled");
                });
                test("the runtime projection advances enabled -> available", () => {
                        assert.equal(granted(machine.applyTransition("enabled", "project", { platformMatch: true, dependenciesPresent: true })).nextState, "available");
                });
                test("the runtime projection advances enabled -> unavailable on platform mismatch", () => {
                        const result = granted(machine.applyTransition("enabled", "project", { platformMatch: false, dependenciesPresent: true }));
                        assert.equal(result.nextState, "unavailable");
                        assert.equal(result.cause, "platform-mismatch");
                });
                test("runtime recovery advances unavailable -> available without re-approval", () => {
                        assert.equal(granted(machine.applyTransition("unavailable", "project", { platformMatch: true, dependenciesPresent: true, cause: "platform-mismatch" })).nextState, "available");
                });
                test("degraded facts advance available -> unavailable", () => {
                        const result = granted(machine.applyTransition("available", "project", { platformMatch: true, dependenciesPresent: false }));
                        assert.equal(result.nextState, "unavailable");
                        assert.equal(result.cause, "dependency-missing");
                });
                test("an unchanged projection is the non-mutating disclosure", () => {
                        const result = granted(machine.applyTransition("available", "project", { platformMatch: true, dependenciesPresent: true }));
                        assert.equal(result.nextState, "available");
                        const disclosure = result.disclosure;
                        assert.ok(disclosure !== undefined && disclosure !== null);
                        assert.equal(disclosure.code, "D_PROJECTION_UNCHANGED");
                });
                test("disable advances enabled -> unavailable with the operator cause", () => {
                        const result = granted(machine.applyTransition("enabled", "disable", {}));
                        assert.equal(result.nextState, "unavailable");
                        assert.equal(result.cause, "disabled-by-operator");
                });
                test("disable advances available -> unavailable", () => {
                        assert.equal(granted(machine.applyTransition("available", "disable", {})).nextState, "unavailable");
                });
                test("remove advances every non-revoked state -> revoked", () => {
                        for (const state of ["discovered", "imported", "verified", "approved", "enabled", "available", "unavailable"]) {
                                assert.equal(granted(machine.applyTransition(state, "remove", {})).nextState, "revoked", state);
                        }
                });
                test("any transition attempt on revoked is the typed terminal refusal", () => {
                        for (const op of ["register", "verify", "approve", "enable", "disable", "project", "remove"]) {
                                assert.equal(refusedMachine(machine.applyTransition("revoked", op, {})).code, "E_REVOKED_TERMINAL", op);
                        }
                });
                test("approve-unverified returns the exact frozen law text", () => {
                        const refusal = refusedMachine(machine.applyTransition("imported", "approve", {}));
                        assert.equal(refusal.code, "E_APPROVE_REQUIRES_VERIFIED");
                        assert.equal(refusal.law, machine.REFUSALS.E_APPROVE_REQUIRES_VERIFIED.law);
                });
                test("enable-unapproved returns the exact frozen law text", () => {
                        const refusal = refusedMachine(machine.applyTransition("verified", "enable", {}));
                        assert.equal(refusal.code, "E_ENABLE_REQUIRES_APPROVED");
                        assert.equal(refusal.law, machine.REFUSALS.E_ENABLE_REQUIRES_APPROVED.law);
                });
                test("verify on a discovered entry is the typed imported-only refusal", () => {
                        assert.equal(refusedMachine(machine.applyTransition("discovered", "verify", receiptOf("verified"))).code, "E_VERIFY_REQUIRES_IMPORTED");
                });
                test("unknown state, unknown op, and non-transition ops are typed refusals", () => {
                        assert.equal(refusedMachine(machine.applyTransition("limbo", "remove", {})).code, "E_UNKNOWN_STATE");
                        assert.equal(refusedMachine(machine.applyTransition("imported", "frobnicate", {})).code, "E_UNKNOWN_OP");
                        assert.equal(refusedMachine(machine.applyTransition("verified", "inspect", {})).code, "E_OP_NOT_A_TRANSITION");
                });
                test("runtime recovery is forbidden from verification-failed unavailability", () => {
                        assert.equal(refusedMachine(machine.applyTransition("unavailable", "project", { platformMatch: true, dependenciesPresent: true, cause: "verification-failed" })).code, "E_RECOVERY_FORBIDDEN");
                });
                test("runtime recovery is forbidden from operator-disabled unavailability", () => {
                        assert.equal(refusedMachine(machine.applyTransition("unavailable", "project", { platformMatch: true, dependenciesPresent: true, cause: "disabled-by-operator" })).code, "E_RECOVERY_FORBIDDEN");
                });
                test("the projection refuses entries that were never enabled", () => {
                        for (const state of ["discovered", "imported", "verified", "approved"]) {
                                assert.equal(refusedMachine(machine.applyTransition(state, "project", { platformMatch: true, dependenciesPresent: true })).code, "E_PROJECT_REQUIRES_ENABLED", state);
                        }
                });
                test("canTransition mirrors the granted edges", () => {
                        assert.ok(machine.canTransition("discovered", "register"));
                        assert.ok(machine.canTransition("imported", "verify"));
                        assert.ok(!machine.canTransition("imported", "approve"));
                        assert.ok(!machine.canTransition("revoked", "remove"));
                        assert.ok(!machine.canTransition("limbo", "register"));
                });
        });

        suite("runtime: lifecycle and the eleven operations", () => {
                test("discover records a discovered entry and inspect returns the honest record", async () => {
                        const { registry } = await makeRegistry();
                        const result = mustOk(await registry.discover(DISCOVERY));
                        assert.equal(result.state, "discovered");
                        assert.equal(result.disclosure, null);
                        const view = mustOk(await registry.inspect(result.entryId)).entry;
                        assert.equal(view.state, "discovered");
                        assert.equal(view.contentHash, DISCOVERY.contentHash);
                        assert.equal(view.verification.status, "unverified");
                        assert.equal(view.imported, null);
                        assert.deepEqual(view.transitions, [{ seq: 1, at: 1000, op: "discover", fromState: null, toState: "discovered" }]);
                });
                test("discover is idempotent on content hash: one entry, typed disclosure, journal unchanged", async () => {
                        const { registry, files } = await makeRegistry();
                        mustOk(await registry.discover(DISCOVERY));
                        const journalBefore = files.get("/reg/registry-journal.jsonl") ?? "";
                        const second = mustOk(await registry.discover(DISCOVERY));
                        const disclosure = second.disclosure;
                        assert.ok(disclosure !== null);
                        assert.equal(disclosure.code, "D_DISCOVER_DUPLICATE");
                        assert.equal(files.get("/reg/registry-journal.jsonl"), journalBefore);
                        assert.equal(mustOk(await registry.query({})).count, 1);
                });
                test("register lands the import chain and the entry enters unverified", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await discoverImported(registry);
                        const view = mustOk(await registry.inspect(entryId)).entry;
                        assert.equal(view.state, "imported");
                        assert.equal(view.verification.status, "unverified");
                        assert.equal(view.verification.receipts.length, 0);
                        const imported = view.imported;
                        assert.ok(imported !== null);
                        assert.equal(imported.license, "MIT");
                        assert.equal(imported.version, "1.0.0");
                        assert.equal(imported.provenance.origin, "community-project");
                });
                test("register without a matching discovery is the typed refusal naming the hash", async () => {
                        const { registry } = await makeRegistry();
                        const refusal = mustRefuse(await registry.register(IMPORTED));
                        assert.equal(refusal.code, "E_REGISTER_REQUIRES_DISCOVERED");
                        assert.ok(refusal.detail !== null && refusal.detail.includes("a".repeat(64)));
                });
                test("a partial receipt is recorded without advancing the state", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await discoverImported(registry);
                        const result = mustOk(await registry.verify(entryId, receiptOf("verified-partial")));
                        assert.equal(result.state, "imported");
                        const disclosure = result.disclosure;
                        assert.ok(disclosure !== null);
                        assert.equal(disclosure.code, "D_VERIFICATION_PARTIAL");
                        const view = mustOk(await registry.inspect(entryId)).entry;
                        assert.equal(view.state, "imported");
                        assert.equal(view.verification.status, "verified-partial");
                        assert.equal(view.verification.receipts.length, 1);
                });
                test("approve records who, when, scope, and the acknowledged permissions", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await verifiedEntry(registry);
                        mustOk(await registry.approve(entryId, APPROVAL));
                        const view = mustOk(await registry.inspect(entryId)).entry;
                        const approval = view.approval;
                        assert.ok(approval !== null);
                        assert.equal(approval.approver, "operator-1");
                        assert.equal(approval.at, 1000);
                        assert.deepEqual(approval.scope, SCOPED);
                        assert.deepEqual([...approval.acknowledgedPermissions], ["read-files"]);
                });
                test("the full lifecycle reaches available through the ruled gates", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await enabledEntry(registry);
                        mustOk(await registry.projectAvailability(entryId, { platformMatch: true, dependenciesPresent: true }));
                        assert.equal(mustOk(await registry.inspect(entryId)).entry.state, "available");
                });
                test("remove revokes; a later use-attempt is the typed terminal failure", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await verifiedEntry(registry);
                        mustOk(await registry.remove(entryId, "operator cleanup"));
                        const view = mustOk(await registry.inspect(entryId)).entry;
                        assert.equal(view.state, "revoked");
                        const revocation = view.revocation;
                        assert.ok(revocation !== null);
                        assert.equal(revocation.reason, "operator cleanup");
                        assert.equal(mustRefuse(await registry.enable(entryId)).code, "E_REVOKED_TERMINAL");
                });
                test("verify on a revoked entry is the typed terminal refusal with the exact law", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await verifiedEntry(registry);
                        mustOk(await registry.remove(entryId));
                        const refusal = mustRefuse(await registry.verify(entryId, receiptOf("verified")));
                        assert.equal(refusal.code, "E_REVOKED_TERMINAL");
                        assert.equal(refusal.law, machine.REFUSALS.E_REVOKED_TERMINAL.law);
                });
                test("operations before load fail closed", async () => {
                        const fs = makeMemoryFs();
                        const { clock } = makeClock();
                        const registry = createRegistry({ root: "/reg", clock, fsPort: fs, scope: SCOPED });
                        assert.equal(mustRefuse(await registry.discover(DISCOVERY)).code, "E_NOT_LOADED");
                });
                test("a malformed discovery refuses with the violation named", async () => {
                        const { registry } = await makeRegistry();
                        const refusal = mustRefuse(await registry.discover({ sourceKind: "not-a-source" }));
                        assert.equal(refusal.code, "E_DISCOVERY_MALFORMED");
                        assert.ok(refusal.detail !== null && refusal.detail.includes("not-a-source"));
                });
                test("inspect and verify on an unknown entry are typed refusals", async () => {
                        const { registry } = await makeRegistry();
                        assert.equal(mustRefuse(await registry.inspect("e-nope")).code, "E_ENTRY_UNKNOWN");
                        assert.equal(mustRefuse(await registry.verify("e-nope", receiptOf("verified"))).code, "E_ENTRY_UNKNOWN");
                });
                test("verify on a discovered entry is the typed imported-only refusal", async () => {
                        const { registry } = await makeRegistry();
                        const discovered = mustOk(await registry.discover(DISCOVERY));
                        assert.equal(mustRefuse(await registry.verify(discovered.entryId, receiptOf("verified"))).code, "E_VERIFY_REQUIRES_IMPORTED");
                });
                test("a receipt with an unknown status or empty checks fails closed", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await discoverImported(registry);
                        assert.equal(mustRefuse(await registry.verify(entryId, { verificationStatus: "probably-fine" })).code, "E_RECEIPT_MALFORMED");
                        assert.equal(mustRefuse(await registry.verify(entryId, { verificationStatus: "verified", checks: [] })).code, "E_RECEIPT_MALFORMED");
                });
                test("approve on an unverified entry refuses with the exact law", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await discoverImported(registry);
                        const refusal = mustRefuse(await registry.approve(entryId, APPROVAL));
                        assert.equal(refusal.code, "E_APPROVE_REQUIRES_VERIFIED");
                        assert.equal(refusal.law, machine.REFUSALS.E_APPROVE_REQUIRES_VERIFIED.law);
                });
                test("enable on a verified-but-unapproved entry refuses with the exact law", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await verifiedEntry(registry);
                        const refusal = mustRefuse(await registry.enable(entryId));
                        assert.equal(refusal.code, "E_ENABLE_REQUIRES_APPROVED");
                        assert.equal(refusal.law, machine.REFUSALS.E_ENABLE_REQUIRES_APPROVED.law);
                });
                test("approve requires the declared permissions to be acknowledged", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await verifiedEntry(registry);
                        const refusal = mustRefuse(await registry.approve(entryId, { approver: "operator-1", acknowledgedPermissions: [] }));
                        assert.equal(refusal.code, "E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH");
                        assert.ok(refusal.detail !== null && refusal.detail.includes("read-files"));
                });
                test("disable takes an enabled entry unavailable by operator cause", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await enabledEntry(registry);
                        mustOk(await registry.disable(entryId, "kill switch"));
                        const view = mustOk(await registry.inspect(entryId)).entry;
                        assert.equal(view.state, "unavailable");
                        assert.equal(view.unavailableCause, "disabled-by-operator");
                });
                test("runtime recovery after operator disable is forbidden", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await enabledEntry(registry);
                        mustOk(await registry.disable(entryId));
                        assert.equal(mustRefuse(await registry.projectAvailability(entryId, { platformMatch: true, dependenciesPresent: true })).code, "E_RECOVERY_FORBIDDEN");
                });
                test("runtime recovery after a platform mismatch is granted without re-approval", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await enabledEntry(registry);
                        mustOk(await registry.projectAvailability(entryId, { platformMatch: false, dependenciesPresent: true }));
                        assert.equal(mustOk(await registry.inspect(entryId)).entry.state, "unavailable");
                        mustOk(await registry.projectAvailability(entryId, { platformMatch: true, dependenciesPresent: true }));
                        assert.equal(mustOk(await registry.inspect(entryId)).entry.state, "available");
                });
                test("verification-failed lands unavailable with the typed cause and no runtime recovery", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await discoverImported(registry);
                        const result = mustOk(await registry.verify(entryId, receiptOf("verification-failed")));
                        assert.equal(result.state, "unavailable");
                        const view = mustOk(await registry.inspect(entryId)).entry;
                        assert.equal(view.unavailableCause, "verification-failed");
                        assert.equal(mustRefuse(await registry.projectAvailability(entryId, { platformMatch: true, dependenciesPresent: true })).code, "E_RECOVERY_FORBIDDEN");
                });
        });

        suite("runtime: the import guard (ZC-007 canImport)", () => {
                test("a missing license refuses with the violation named", async () => {
                        const { registry } = await makeRegistry();
                        mustOk(await registry.discover(DISCOVERY));
                        const refusal = mustRefuse(await registry.register({ ...IMPORTED, license: "" }));
                        assert.equal(refusal.code, "E_IMPORT_MISSING_LICENSE");
                        assert.ok(refusal.detail !== null && refusal.detail.includes("license"));
                });
                test("a missing digest refuses with the violation named", async () => {
                        const { registry } = await makeRegistry();
                        mustOk(await registry.discover(DISCOVERY));
                        const refusal = mustRefuse(await registry.register({ ...IMPORTED, digest: "" }));
                        assert.equal(refusal.code, "E_IMPORT_MISSING_DIGEST");
                        assert.ok(refusal.detail !== null && refusal.detail.includes("digest"));
                });
                test("an out-of-table permission refuses with the permission named", async () => {
                        const { registry } = await makeRegistry();
                        mustOk(await registry.discover(DISCOVERY));
                        const refusal = mustRefuse(await registry.register({ ...IMPORTED, permissions: ["read-files", "fly-spaceship"] }));
                        assert.equal(refusal.code, "E_IMPORT_PERMISSION_OUT_OF_TABLE");
                        assert.ok(refusal.detail !== null && refusal.detail.includes("fly-spaceship"));
                });
                test("an imported entry claiming a verified status refuses: entries enter unverified", async () => {
                        const { registry } = await makeRegistry();
                        mustOk(await registry.discover(DISCOVERY));
                        assert.equal(mustRefuse(await registry.register({ ...IMPORTED, verificationStatus: "verified" })).code, "E_ENTRY_ENTERS_UNVERIFIED");
                });
                test("a digest that contradicts the discovered content hash refuses", async () => {
                        const { registry } = await makeRegistry();
                        const discovered = mustOk(await registry.discover(DISCOVERY));
                        const refusal = mustRefuse(await registry.register({ ...IMPORTED, entryId: discovered.entryId, digest: "b".repeat(64) }));
                        assert.equal(refusal.code, "E_REGISTER_DIGEST_MISMATCH");
                        assert.ok(refusal.detail.includes("b".repeat(64)));
                });
        });

        suite("runtime: the drift law", () => {
                test("the same version with a different hash refuses", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await discoverImported(registry);
                        const refusal = mustRefuse(await registry.update(entryId, { ...IMPORTED, digest: "c".repeat(64) }));
                        assert.equal(refusal.code, "E_UPDATE_VERSION_DRIFT");
                        assert.ok(refusal.detail !== null && refusal.detail.includes("c".repeat(64)));
                });
                test("a new version creates a fresh lineage entry and never mutates the old record", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await discoverImported(registry);
                        const before = mustOk(await registry.inspect(entryId)).entry;
                        const result = mustOk(await registry.update(entryId, { ...IMPORTED, version: "2.0.0", digest: "d".repeat(64) }));
                        assert.notEqual(result.entryId, entryId);
                        assert.equal(result.predecessor, entryId);
                        assert.equal(result.state, "imported");
                        const oldView = mustOk(await registry.inspect(entryId)).entry;
                        assert.equal(oldView.state, before.state);
                        assert.equal(oldView.transitions.length, before.transitions.length);
                        assert.deepEqual(oldView.imported, before.imported);
                        assert.equal(oldView.successor, result.entryId);
                        const newView = mustOk(await registry.inspect(result.entryId)).entry;
                        assert.equal(newView.state, "imported");
                        assert.equal(newView.verification.status, "unverified");
                        assert.equal(newView.lineage.predecessor, entryId);
                });
                test("the same version and the same hash is the idempotent disclosure", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await discoverImported(registry);
                        const result = mustOk(await registry.update(entryId, IMPORTED));
                        const disclosure = result.disclosure;
                        assert.ok(disclosure !== null);
                        assert.equal(disclosure.code, "D_UPDATE_IDENTICAL");
                        assert.equal(mustOk(await registry.query({})).count, 1);
                });
        });

        suite("runtime: the query surface", () => {
                test("query by state filters and counts", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await discoverImported(registry);
                        mustOk(await registry.discover({ ...DISCOVERY, contentHash: "e".repeat(64) }));
                        assert.equal(mustOk(await registry.query({ state: "imported" })).count, 1);
                        assert.equal(mustOk(await registry.query({ state: "imported" })).entries[0].entryId, entryId);
                        assert.equal(mustOk(await registry.query({ state: "discovered" })).count, 1);
                        assert.equal(mustOk(await registry.query({})).count, 2);
                });
                test("query by artifact kind, platform, and permission tier", async () => {
                        const { registry } = await makeRegistry();
                        await discoverImported(registry);
                        assert.equal(mustOk(await registry.query({ artifactKind: "cli" })).count, 1);
                        assert.equal(mustOk(await registry.query({ platform: "linux-x64" })).count, 1);
                        assert.equal(mustOk(await registry.query({ permissionTier: "low" })).count, 1);
                        assert.equal(mustOk(await registry.query({ permissionTier: "moderate" })).count, 0);
                });
                test("combined predicates intersect", async () => {
                        const { registry } = await makeRegistry();
                        await discoverImported(registry);
                        const combined = mustOk(await registry.query({ state: "imported", artifactKind: "cli", platform: "linux-x64", permissionTier: "low" }));
                        assert.equal(combined.count, 1);
                        assert.equal(mustOk(await registry.query({ state: "imported", platform: "darwin-arm64" })).count, 0);
                });
                test("malformed predicates fail closed with the violation named", async () => {
                        const { registry } = await makeRegistry();
                        assert.equal(mustRefuse(await registry.query({ state: "limbo" })).code, "E_QUERY_MALFORMED");
                        assert.equal(mustRefuse(await registry.query({ platform: "plan9" })).code, "E_QUERY_MALFORMED");
                        assert.equal(mustRefuse(await registry.query({ rank: "best" })).code, "E_QUERY_MALFORMED");
                });
                test("ordering is stable by entry id", async () => {
                        const { registry } = await makeRegistry();
                        for (let i = 0; i < 3; i++) {
                                mustOk(await registry.discover({ ...DISCOVERY, contentHash: String(i).repeat(64) }));
                        }
                        const all = mustOk(await registry.query({}));
                        const ids = all.entries.map((summary) => summary.entryId);
                        assert.deepEqual(ids, [...ids].sort());
                });
        });

        suite("runtime: the compare surface", () => {
                test("compare returns the typed diff fields", async () => {
                        const { registry } = await makeRegistry();
                        const entryId = await discoverImported(registry);
                        const next = mustOk(await registry.update(entryId, {
                                ...IMPORTED,
                                version: "2.0.0",
                                digest: "d".repeat(64),
                                license: "Apache-2.0",
                                permissions: ["read-files", "network-access"],
                                endpoints: ["https://example.com/demo", "https://example.com/two"],
                                platforms: ["linux-x64", "linux-arm64"]
                        }));
                        const diff = mustOk(await registry.compare(entryId, next.entryId)).diff;
                        assert.equal(diff.differs, true);
                        assert.equal(diff.version.differs, true);
                        assert.equal(diff.digest.differs, true);
                        assert.equal(diff.license.differs, true);
                        assert.deepEqual(diff.permissions, { onlyInA: [], onlyInB: ["network-access"] });
                        assert.deepEqual(diff.endpoints, { onlyInA: [], onlyInB: ["https://example.com/two"] });
                        assert.deepEqual(diff.platforms, { onlyInA: [], onlyInB: ["linux-arm64"] });
                });
                test("compare refuses unknown or pre-import entries", async () => {
                        const { registry } = await makeRegistry();
                        assert.equal(mustRefuse(await registry.compare("e-nope", "e-nope-2")).code, "E_ENTRY_UNKNOWN");
                        const entryId = await discoverImported(registry);
                        const stillDiscovered = mustOk(await registry.discover({ ...DISCOVERY, contentHash: "d".repeat(64), name: "other-capability" }));
                        const refusal = mustRefuse(await registry.compare(stillDiscovered.entryId, entryId));
                        assert.equal(refusal.code, "E_COMPARE_REQUIRES_IMPORTED");
                });
        });

        suite("runtime: persistence, restart recovery, determinism", () => {
                test("every journal line carries scope, contract version, and contiguous sequence numbers", async () => {
                        const { registry, files } = await makeRegistry();
                        await enabledEntry(registry);
                        const text = files.get("/reg/registry-journal.jsonl") ?? "";
                        const lines = text.split("\n").filter((line) => line !== "");
                        assert.ok(lines.length >= 5);
                        lines.forEach((line, index) => {
                                const record = JSON.parse(line);
                                assert.equal(record.seq, index + 1);
                                assert.deepEqual(record.scope, SCOPED);
                                assert.equal(record.contractVersion, machine.REGISTRY_CONTRACT_VERSION);
                        });
                });
                test("restart rebuilds byte-identical state from the journal", async () => {
                        const harness = await makeRegistry();
                        const entryId = await enabledEntry(harness.registry);
                        mustOk(await harness.registry.projectAvailability(entryId, { platformMatch: true, dependenciesPresent: true }));
                        const journalBefore = harness.files.get("/reg/registry-journal.jsonl") ?? "";
                        const snapshotBefore = harness.files.get("/reg/registry-state.json") ?? "";
                        const before = mustOk(await harness.registry.inspect(entryId)).entry;
                        const second = createRegistry({ root: "/reg", clock: makeClock().clock, fsPort: { readFile: async (p: string) => harness.files.get(p) ?? (() => { throw new Error("ENOENT"); })(), writeFile: async (p: string, t: string) => { harness.files.set(p, t); }, appendFile: async (p: string, t: string) => { harness.files.set(p, (harness.files.get(p) ?? "") + t); }, mkdir: async () => {}, readdir: async () => [] }, scope: SCOPED });
                        const loaded = mustOk(await second.load());
                        assert.equal(loaded.recovered, null);
                        assert.equal(loaded.entries, 1);
                        assert.equal(harness.files.get("/reg/registry-journal.jsonl"), journalBefore);
                        assert.equal(harness.files.get("/reg/registry-state.json"), snapshotBefore);
                        const after = mustOk(await second.inspect(entryId)).entry;
                        assert.deepEqual(after, before);
                });
                test("restart on a real temp directory rebuilds the identical state", async () => {
                        const dir = mkdtempSync(join(tmpdir(), "flauz-registry-"));
                        try {
                                const { clock } = makeClock();
                                const first = createRegistry({ root: dir, clock, fsPort: realFsPort, scope: SCOPED });
                                mustOk(await first.load());
                                const entryId = await enabledEntry(first);
                                const before = mustOk(await first.inspect(entryId)).entry;
                                const journalBefore = await realFsPort.readFile(join(dir, "registry-journal.jsonl"), "utf8");
                                const second = createRegistry({ root: dir, clock: makeClock().clock, fsPort: realFsPort, scope: SCOPED });
                                const loaded = mustOk(await second.load());
                                assert.equal(loaded.recovered, null);
                                const after = mustOk(await second.inspect(entryId)).entry;
                                assert.deepEqual(after, before);
                                assert.equal(await realFsPort.readFile(join(dir, "registry-journal.jsonl"), "utf8"), journalBefore);
                        } finally {
                                rmSync(dir, { recursive: true, force: true });
                        }
                });
                test("a torn journal line fails closed with the typed recovery error", async () => {
                        const harness = await makeRegistry();
                        await discoverImported(harness.registry);
                        const path = "/reg/registry-journal.jsonl";
                        const text = harness.files.get(path) ?? "";
                        harness.files.set(path, text.slice(0, text.length - 5));
                        const fs = makeMemoryFs();
                        for (const [key, value] of harness.files) {
                                fs.files.set(key, value);
                        }
                        const second = createRegistry({ root: "/reg", clock: makeClock().clock, fsPort: fs, scope: SCOPED });
                        const refusal = mustRefuse(await second.load());
                        assert.equal(refusal.code, "E_JOURNAL_TORN");
                });
                test("a missing journal line fails closed with the typed recovery error", async () => {
                        const harness = await makeRegistry();
                        await verifiedEntry(harness.registry);
                        const path = "/reg/registry-journal.jsonl";
                        const lines = (harness.files.get(path) ?? "").split("\n");
                        lines.splice(1, 1);
                        harness.files.set(path, lines.join("\n"));
                        const fs = makeMemoryFs();
                        for (const [key, value] of harness.files) {
                                fs.files.set(key, value);
                        }
                        const second = createRegistry({ root: "/reg", clock: makeClock().clock, fsPort: fs, scope: SCOPED });
                        const refusal = mustRefuse(await second.load());
                        assert.equal(refusal.code, "E_JOURNAL_TORN");
                        assert.ok(refusal.detail !== null && refusal.detail.includes("missing"));
                });
                test("a divergent snapshot fails closed", async () => {
                        const harness = await makeRegistry();
                        await discoverImported(harness.registry);
                        const path = "/reg/registry-state.json";
                        const parsed = JSON.parse(harness.files.get(path) ?? "{}");
                        parsed.entries[0].state = "approved";
                        harness.files.set(path, JSON.stringify(parsed));
                        const fs = makeMemoryFs();
                        for (const [key, value] of harness.files) {
                                fs.files.set(key, value);
                        }
                        const second = createRegistry({ root: "/reg", clock: makeClock().clock, fsPort: fs, scope: SCOPED });
                        assert.equal(mustRefuse(await second.load()).code, "E_SNAPSHOT_MISMATCH");
                });
                test("an absent snapshot is rebuilt byte-identically from journal replay", async () => {
                        const harness = await makeRegistry();
                        const entryId = await enabledEntry(harness.registry);
                        const snapshotBefore = harness.files.get("/reg/registry-state.json") ?? "";
                        harness.files.delete("/reg/registry-state.json");
                        const fs = makeMemoryFs();
                        for (const [key, value] of harness.files) {
                                fs.files.set(key, value);
                        }
                        const second = createRegistry({ root: "/reg", clock: makeClock().clock, fsPort: fs, scope: SCOPED });
                        const loaded = mustOk(await second.load());
                        const recovered = loaded.recovered;
                        assert.ok(recovered !== null);
                        assert.equal(recovered.code, "D_SNAPSHOT_REBUILT");
                        assert.equal(fs.files.get("/reg/registry-state.json"), snapshotBefore);
                        assert.deepEqual(mustOk(await second.inspect(entryId)).entry, mustOk(await harness.registry.inspect(entryId)).entry);
                });
                test("determinism: two full runs with the same clock and inputs produce byte-identical files", async () => {
                        const runA = await runScenario();
                        const runB = await runScenario();
                        assert.equal(runA.journal, runB.journal);
                        assert.equal(runA.snapshot, runB.snapshot);
                });
        });
});