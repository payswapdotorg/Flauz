// gate.test.ts — CR-008 (B2, Phase C-R wave 3): the mocha tdd battery.
//
// Evidence label: local-real — a REAL registry (createRegistry over the
// REAL filesystem through an fs port) driven by the REAL gate; the clock
// is injected everywhere; temp roots are counter-derived (no randomness
// primitives anywhere in this subtree).
//
// MIT License — see gate.ts for the full header box.
// Copyright (c) Flauz contributors.

import { strict as assert } from "node:assert";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry, REFUSALS, VERIFICATION_STATUSES } from "../registry/registry.mjs";
import type { FsPort, RegistryRuntime } from "../registry/registry.mjs";
import {
	createGate,
	loadGate,
	GateError,
	GATE_CONTRACT_VERSION,
	GATE_PERMISSION_RISK_TIERS,
	GATE_REFUSALS,
	GATE_WARNINGS
} from "./gate.ts";
import type { GateDecisionInput, GateOptions, GateReceiptInput } from "./gate.ts";

/* ------------------------------------------------------------------ */
/* Shared local-real fixtures.                                         */
/* ------------------------------------------------------------------ */

const SCOPE = Object.freeze({ workspaceId: "ws-cr008", tenantId: "tenant-cr008" });

const realFsPort: FsPort = {
	readFile: (path, encoding) => fsp.readFile(path, encoding),
	writeFile: (path, text) => fsp.writeFile(path, text),
	appendFile: (path, text) => fsp.appendFile(path, text),
	mkdir: async (path, options) => { await fsp.mkdir(path, options); },
	readdir: (path) => fsp.readdir(path)
};

function countingFsPort(base: FsPort): { port: FsPort; counts: { readFile: number; writeFile: number; appendFile: number; mkdir: number; readdir: number } } {
	const counts = { readFile: 0, writeFile: 0, appendFile: 0, mkdir: 0, readdir: 0 };
	const port: FsPort = {
		readFile: async (path, encoding) => {
			counts.readFile += 1;
			return base.readFile(path, encoding);
		},
		writeFile: async (path, text) => {
			counts.writeFile += 1;
			return base.writeFile(path, text);
		},
		appendFile: async (path, text) => {
			counts.appendFile += 1;
			return base.appendFile(path, text);
		},
		mkdir: async (path, options) => {
			counts.mkdir += 1;
			return base.mkdir(path, options);
		},
		readdir: async (path) => {
			counts.readdir += 1;
			return base.readdir(path);
		}
	};
	return { port: port, counts: counts };
}

const BASE_DIR = join(tmpdir(), "flauz-cr008-gate-" + String(process.pid));
let rootCounter = 0;

async function freshRoot(): Promise<string> {
	rootCounter += 1;
	const root = join(BASE_DIR, "t" + String(rootCounter).padStart(3, "0"));
	await fsp.rm(root, { recursive: true, force: true });
	await fsp.mkdir(root, { recursive: true });
	return root;
}

function makeClock(): { clock: () => number; advance: (step?: number) => void } {
	let now = 1000000;
	return {
		clock: () => now,
		advance: (step = 1000) => {
			now += step;
		}
	};
}

function gateRecordsPath(root: string): string {
	return join(root, ".flauz", "gate", "records.jsonl");
}

function journalPath(root: string): string {
	return join(root, "registry-journal.jsonl");
}

async function readOptional(path: string): Promise<string | null> {
	try {
		return await fsp.readFile(path, "utf8");
	} catch (err) {
		if (err !== null && typeof err === "object" && (err as { code?: unknown }).code === "ENOENT") {
			return null;
		}
		throw err;
	}
}

async function readGateRecords(root: string): Promise<Record<string, unknown>[]> {
	const text = await readOptional(gateRecordsPath(root));
	if (text === null || text === "") {
		return [];
	}
	return text.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
}

let seedCounter = 0;

interface Seed {
	registry: RegistryRuntime;
	entryId: string;
	contentHash: string;
	root: string;
	clock: { clock: () => number; advance: (step?: number) => void };
}

async function seedEntry(options?: { permissions?: readonly string[]; register?: boolean }): Promise<Seed> {
	const root = await freshRoot();
	const clock = makeClock();
	const registry = createRegistry({ root: root, clock: clock.clock, fsPort: realFsPort, scope: SCOPE });
	const load = await registry.load();
	if (load.ok !== true) {
		assert.fail("seed: registry load must succeed");
	}
	seedCounter += 1;
	const contentHash = "sha256-cr008-seed-" + String(seedCounter);
	const discovery = await registry.discover({ sourceKind: "user-spec", artifactKind: "cli", contentHash: contentHash, version: "1.0.0" });
	if (discovery.ok !== true) {
		assert.fail("seed: discover must succeed");
	}
	if (options?.register === false) {
		return { registry: registry, entryId: discovery.entryId, contentHash: contentHash, root: root, clock: clock };
	}
	clock.advance();
	const registered = await registry.register({
		entryId: discovery.entryId,
		digest: contentHash,
		version: "1.0.0",
		license: "MIT",
		permissions: [...(options?.permissions ?? ["read-files"])],
		endpoints: [],
		platforms: ["darwin-arm64"],
		artifactKind: "cli",
		provenance: { seed: String(seedCounter) }
	});
	if (registered.ok !== true) {
		assert.fail("seed: register must succeed");
	}
	return { registry: registry, entryId: registered.entryId, contentHash: contentHash, root: root, clock: clock };
}

async function gateOn(seed: Seed): Promise<ReturnType<typeof createGate>> {
	return createGate({ root: seed.root, clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE });
}

async function witnessFor(root: string, clock: () => number): Promise<RegistryRuntime> {
	const witness = createRegistry({ root: root, clock: clock, fsPort: realFsPort, scope: SCOPE });
	const load = await witness.load();
	if (load.ok !== true) {
		assert.fail("witness load must succeed");
	}
	return witness;
}

function verifiedReceipt(): { verificationStatus: string; checks: { checkId: string; verdict: string }[] } {
	return { verificationStatus: "verified", checks: [{ checkId: "sig", verdict: "pass" }, { checkId: "manifest", verdict: "pass" }] };
}

async function expectRefusal(promise: Promise<unknown>): Promise<GateError> {
	try {
		await promise;
	} catch (err) {
		if (!(err instanceof GateError)) {
			assert.fail("expected a GateError refusal, got: " + String(err));
		}
		return err;
	}
	assert.fail("expected a GateError refusal; the call succeeded");
}

async function rewriteGateRecords(root: string, transform: (records: Record<string, unknown>[]) => Record<string, unknown>[]): Promise<void> {
	const records = await readGateRecords(root);
	const rewritten = transform(records);
	await fsp.writeFile(gateRecordsPath(root), rewritten.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

/* ------------------------------------------------------------------ */
/* The battery.                                                        */
/* ------------------------------------------------------------------ */

suite("CR-008 verification + permission gate", function () {
	suiteTeardown(async function () {
		await fsp.rm(BASE_DIR, { recursive: true, force: true });
	});

	suite("construction, restart, and gate-record replay", function () {
		test("createGate on a fresh root loads the registry and exposes the gate surface", async function () {
			const root = await freshRoot();
			const clock = makeClock();
			const gate = await createGate({ root: root, clock: clock.clock, fsPort: realFsPort, scope: SCOPE });
			assert.strictEqual(typeof gate.submitVerificationReceipt, "function");
			assert.strictEqual(typeof gate.decidePermissions, "function");
			assert.strictEqual(typeof gate.approve, "function");
			assert.strictEqual(typeof gate.enable, "function");
			assert.strictEqual(typeof gate.gatePolicySummary, "function");
		});

		test("createGate sees entries the seeding registry instance registered (one journal)", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const summary = await gate.gatePolicySummary(seed.entryId);
			assert.strictEqual(summary.state, "imported");
			assert.strictEqual(summary.verification.status, "unverified");
		});

		test("loadGate replays mid-flow: a decision recorded before restart still enables approve after restart", async function () {
			const seed = await seedEntry();
			const gate1 = await gateOn(seed);
			await gate1.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			const gate2 = await loadGate(seed.root, { clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE });
			await gate2.decidePermissions(seed.entryId, { approver: "op-restart", acknowledgedPermissions: ["read-files"] });
			const gate3 = await loadGate(seed.root, { clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE });
			const approved = await gate3.approve(seed.entryId);
			assert.strictEqual(approved.state, "approved");
			const gate4 = await loadGate(seed.root, { clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE });
			const enabled = await gate4.enable(seed.entryId);
			assert.strictEqual(enabled.state, "enabled");
		});

		test("loadGate after enable replays the durable warning records", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified-partial", checks: [{ checkId: "sig", verdict: "pass" }] });
			seed.clock.advance();
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			seed.clock.advance();
			await gate.decidePermissions(seed.entryId, { approver: "op-w", acknowledgedPermissions: ["read-files"] });
			seed.clock.advance();
			await gate.approve(seed.entryId);
			seed.clock.advance();
			await gate.enable(seed.entryId);
			const gate2 = await loadGate(seed.root, { clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE });
			const summary = await gate2.gatePolicySummary(seed.entryId);
			assert.strictEqual(summary.gateWarnings.length, 1);
			assert.strictEqual(summary.gateWarnings[0].code, "W_ENABLE_VERIFICATION_PARTIAL");
			assert.strictEqual(summary.gateWarnings[0].census.partialReceiptCount, 1);
		});

		test("a torn gate records line fails closed with E_JOURNAL_TORN (verbatim law)", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			const text = await fsp.readFile(gateRecordsPath(seed.root), "utf8");
			await fsp.writeFile(gateRecordsPath(seed.root), text.slice(0, -1));
			const refusal = await expectRefusal(loadGate(seed.root, { clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE }));
			assert.strictEqual(refusal.code, "E_JOURNAL_TORN");
			assert.strictEqual(refusal.law, REFUSALS.E_JOURNAL_TORN.law);
			assert.strictEqual(refusal.source, "gate");
		});

		test("an out-of-order gate records sequence fails closed with E_JOURNAL_TORN", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			await rewriteGateRecords(seed.root, (records) => {
				records[0].seq = 9;
				return records;
			});
			const refusal = await expectRefusal(loadGate(seed.root, { clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE }));
			assert.strictEqual(refusal.code, "E_JOURNAL_TORN");
		});

		test("a gate record from a foreign scope fails closed with E_SNAPSHOT_MISMATCH", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			await rewriteGateRecords(seed.root, (records) => {
				records[0].scope = { workspaceId: "ws-other", tenantId: "tenant-other" };
				return records;
			});
			const refusal = await expectRefusal(loadGate(seed.root, { clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE }));
			assert.strictEqual(refusal.code, "E_SNAPSHOT_MISMATCH");
			assert.strictEqual(refusal.law, REFUSALS.E_SNAPSHOT_MISMATCH.law);
		});

		test("a gate record under a foreign contract version fails closed with E_SNAPSHOT_MISMATCH", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			await rewriteGateRecords(seed.root, (records) => {
				records[0].contractVersion = "cr-007.0";
				return records;
			});
			const refusal = await expectRefusal(loadGate(seed.root, { clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE }));
			assert.strictEqual(refusal.code, "E_SNAPSHOT_MISMATCH");
		});

		test("a gate record referencing an entry the registry does not know fails closed with E_JOURNAL_UNLAWFUL", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			const records = await readGateRecords(seed.root);
			records.push({ seq: records.length + 1, at: 1, scope: SCOPE, contractVersion: GATE_CONTRACT_VERSION, kind: "receipt", entryId: "e-unknown", data: { receipt: {}, state: "verified", disclosureCode: null } });
			await fsp.writeFile(gateRecordsPath(seed.root), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
			const refusal = await expectRefusal(loadGate(seed.root, { clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE }));
			assert.strictEqual(refusal.code, "E_JOURNAL_UNLAWFUL");
			assert.strictEqual(refusal.law, REFUSALS.E_JOURNAL_UNLAWFUL.law);
		});

		test("an unparseable gate records line fails closed with E_JOURNAL_TORN", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			await fsp.writeFile(gateRecordsPath(seed.root), "{not json\n");
			const refusal = await expectRefusal(loadGate(seed.root, { clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE }));
			assert.strictEqual(refusal.code, "E_JOURNAL_TORN");
		});

		test("a torn registry journal fails closed through the gate with E_JOURNAL_TORN, source registry", async function () {
			const seed = await seedEntry();
			const journalText = await fsp.readFile(journalPath(seed.root), "utf8");
			await fsp.writeFile(journalPath(seed.root), journalText.slice(0, -1));
			const refusal = await expectRefusal(createGate({ root: seed.root, clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE }));
			assert.strictEqual(refusal.code, "E_JOURNAL_TORN");
			assert.strictEqual(refusal.law, REFUSALS.E_JOURNAL_TORN.law);
			assert.strictEqual(refusal.source, "registry");
		});

		test("factory misuse throws TypeError (root, clock, fsPort, scope)", async function () {
			const clock = makeClock();
			await assert.rejects(createGate({ root: "", clock: clock.clock, fsPort: realFsPort, scope: SCOPE }), TypeError);
			await assert.rejects(createGate({ root: 42, clock: clock.clock, fsPort: realFsPort, scope: SCOPE } as unknown as GateOptions), TypeError);
			await assert.rejects(createGate({ root: "/tmp/x", clock: null, fsPort: realFsPort, scope: SCOPE } as unknown as GateOptions), TypeError);
			await assert.rejects(createGate({ root: "/tmp/x", clock: clock.clock, fsPort: {} as FsPort, scope: SCOPE }), TypeError);
			await assert.rejects(createGate({ root: "/tmp/x", clock: clock.clock, fsPort: realFsPort, scope: { workspaceId: "", tenantId: "t" } }), TypeError);
		});
	});

	suite("verification receipt validation matrix", function () {
		test("non-object receipts fail closed with E_RECEIPT_MALFORMED (verbatim law)", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			for (const bad of [null, [], ["verified"], "verified", 42] as unknown[]) {
				const refusal = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, bad as GateReceiptInput));
				assert.strictEqual(refusal.code, "E_RECEIPT_MALFORMED");
				assert.strictEqual(refusal.law, REFUSALS.E_RECEIPT_MALFORMED.law);
				assert.strictEqual(refusal.source, "gate");
			}
		});

		test("a receipt without a verification status fails closed", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, { checks: [{ checkId: "sig", verdict: "pass" }] }));
			assert.strictEqual(refusal.code, "E_RECEIPT_MALFORMED");
		});

		test("a receipt with a status outside the frozen vocabulary fails closed", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "banana", checks: [{ checkId: "sig", verdict: "pass" }] }));
			assert.strictEqual(refusal.code, "E_RECEIPT_MALFORMED");
		});

		test("a receipt with a non-string status fails closed", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, { verificationStatus: 42, checks: [{ checkId: "sig", verdict: "pass" }] }));
			assert.strictEqual(refusal.code, "E_RECEIPT_MALFORMED");
		});

		test("a receipt without a checks array fails closed (gate strictness: checks are required)", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified" }));
			assert.strictEqual(refusal.code, "E_RECEIPT_MALFORMED");
			assert.ok(refusal.detail !== null && refusal.detail.includes("checks"));
		});

		test("a receipt whose checks is not an array fails closed", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			for (const bad of [42, "sig"] as unknown[]) {
				const refusal = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified", checks: bad }));
				assert.strictEqual(refusal.code, "E_RECEIPT_MALFORMED");
			}
		});

		test("a receipt with an empty checks array fails closed (the machine's own law)", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified", checks: [] }));
			assert.strictEqual(refusal.code, "E_RECEIPT_MALFORMED");
			assert.ok(refusal.detail !== null && refusal.detail.includes("empty"));
		});

		test("a check that is not an object fails closed", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified", checks: ["sig"] }));
			assert.strictEqual(refusal.code, "E_RECEIPT_MALFORMED");
			assert.ok(refusal.detail !== null && refusal.detail.includes("receipt.checks[0]"));
		});

		test("a check missing its verdict fails closed", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified", checks: [{ checkId: "sig" }] }));
			assert.strictEqual(refusal.code, "E_RECEIPT_MALFORMED");
		});

		test("a check missing its checkId fails closed", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified", checks: [{ verdict: "pass" }] }));
			assert.strictEqual(refusal.code, "E_RECEIPT_MALFORMED");
		});

		test("empty-string checkId or verdict fails closed", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const a = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified", checks: [{ checkId: "", verdict: "pass" }] }));
			assert.strictEqual(a.code, "E_RECEIPT_MALFORMED");
			const b = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified", checks: [{ checkId: "sig", verdict: "" }] }));
			assert.strictEqual(b.code, "E_RECEIPT_MALFORMED");
		});

		test("a check carrying extra fields passes (the shape is a minimum)", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const outcome = await gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified", checks: [{ checkId: "sig", verdict: "pass", durationMs: 12 }] });
			assert.strictEqual(outcome.state, "verified");
		});

		test("refused submissions write no gate records", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await expectRefusal(gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "banana", checks: [{ checkId: "sig", verdict: "pass" }] }));
			assert.strictEqual(await readOptional(gateRecordsPath(seed.root)), null);
		});
	});

	suite("driving the registry's verify", function () {
		test("a verified receipt drives imported -> verified and records the evidence", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const outcome = await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			assert.strictEqual(outcome.state, "verified");
			assert.strictEqual(outcome.disclosure, null);
			const records = await readGateRecords(seed.root);
			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].kind, "receipt");
			const summary = await gate.gatePolicySummary(seed.entryId);
			assert.strictEqual(summary.verification.status, "verified");
			assert.strictEqual(summary.verification.receiptCount, 1);
		});

		test("a verification-failed receipt routes to the machine's unavailable leg with cause verification-failed", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const outcome = await gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verification-failed", checks: [{ checkId: "sig", verdict: "fail" }] });
			assert.strictEqual(outcome.state, "unavailable");
			const summary = await gate.gatePolicySummary(seed.entryId);
			assert.strictEqual(summary.state, "unavailable");
			assert.strictEqual(summary.unavailableCause, "verification-failed");
			assert.strictEqual(summary.verification.receiptsByStatus["verification-failed"], 1);
		});

		test("a verified-partial receipt is recorded without advancing (D_VERIFICATION_PARTIAL)", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const outcome = await gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified-partial", checks: [{ checkId: "sig", verdict: "pass" }] });
			assert.strictEqual(outcome.state, "imported");
			assert.strictEqual(outcome.disclosure?.code, "D_VERIFICATION_PARTIAL");
			const summary = await gate.gatePolicySummary(seed.entryId);
			assert.strictEqual(summary.verification.receiptCount, 1);
			assert.strictEqual(summary.verification.receiptsByStatus["verified-partial"], 1);
			assert.deepStrictEqual(summary.verification.partialChecks, [{ checkId: "sig", verdict: "pass" }]);
		});

		test("an unverified receipt is recorded without advancing (D_VERIFICATION_UNCHANGED)", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const outcome = await gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "unverified", checks: [{ checkId: "sig", verdict: "pass" }] });
			assert.strictEqual(outcome.state, "imported");
			assert.strictEqual(outcome.disclosure?.code, "D_VERIFICATION_UNCHANGED");
		});

		test("the verification status vocabulary is the frozen ZC-006 set (CR-008 3d)", async function () {
			assert.deepStrictEqual([...VERIFICATION_STATUSES], ["unverified", "verified", "verified-partial", "verification-failed"]);
		});

		test("a receipt on a discovered (not imported) entry fails with E_VERIFY_REQUIRES_IMPORTED (verbatim law)", async function () {
			const seed = await seedEntry({ register: false });
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, verifiedReceipt()));
			assert.strictEqual(refusal.code, "E_VERIFY_REQUIRES_IMPORTED");
			assert.strictEqual(refusal.law, REFUSALS.E_VERIFY_REQUIRES_IMPORTED.law);
			assert.strictEqual(refusal.source, "registry");
		});

		test("a second receipt on an already-verified entry fails with E_VERIFY_REQUIRES_IMPORTED", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			const refusal = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, verifiedReceipt()));
			assert.strictEqual(refusal.code, "E_VERIFY_REQUIRES_IMPORTED");
		});

		test("a receipt for an unknown entry fails with E_ENTRY_UNKNOWN", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.submitVerificationReceipt("e-nonexistent", verifiedReceipt()));
			assert.strictEqual(refusal.code, "E_ENTRY_UNKNOWN");
			assert.strictEqual(refusal.law, REFUSALS.E_ENTRY_UNKNOWN.law);
		});

		test("a receipt on a revoked entry fails with E_REVOKED_TERMINAL", async function () {
			const seed = await seedEntry();
			const witness = await witnessFor(seed.root, seed.clock.clock);
			const removed = await witness.remove(seed.entryId, "cr008-test-revoke");
			if (removed.ok !== true) {
				assert.fail("remove must succeed");
			}
			const gate = await loadGate(seed.root, { clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE });
			const refusal = await expectRefusal(gate.submitVerificationReceipt(seed.entryId, verifiedReceipt()));
			assert.strictEqual(refusal.code, "E_REVOKED_TERMINAL");
			assert.strictEqual(refusal.law, REFUSALS.E_REVOKED_TERMINAL.law);
		});
	});

	suite("permission decision matrix", function () {
		test("an exact acknowledgement records the decision as evidence", async function () {
			const seed = await seedEntry({ permissions: ["read-files", "write-workspace"] });
			const gate = await gateOn(seed);
			const outcome = await gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["write-workspace", "read-files"] });
			assert.strictEqual(outcome.state, "imported");
			assert.deepStrictEqual([...outcome.recorded.acknowledgedPermissions], ["read-files", "write-workspace"]);
			assert.strictEqual(outcome.recorded.riskAcknowledged, false);
			const records = await readGateRecords(seed.root);
			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].kind, "decision");
		});

		test("a missing acknowledgement fails with E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH and writes no record", async function () {
			const seed = await seedEntry({ permissions: ["read-files", "write-workspace"] });
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["read-files"] }));
			assert.strictEqual(refusal.code, "E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH");
			assert.strictEqual(refusal.law, REFUSALS.E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH.law);
			assert.ok(refusal.detail !== null && refusal.detail.includes("write-workspace"));
			assert.strictEqual(refusal.source, "gate");
			assert.strictEqual((await readGateRecords(seed.root)).length, 0);
		});

		test("an extra acknowledgement of an undeclared permission fails closed", async function () {
			const seed = await seedEntry({ permissions: ["read-files"] });
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["read-files", "network-access"] }));
			assert.strictEqual(refusal.code, "E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH");
			assert.ok(refusal.detail !== null && refusal.detail.includes("network-access"));
		});

		test("missing and extra acknowledgements are both named in the refusal detail", async function () {
			const seed = await seedEntry({ permissions: ["read-files", "write-workspace"] });
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["read-files", "execute-command"] }));
			assert.strictEqual(refusal.code, "E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH");
			assert.ok(refusal.detail !== null && refusal.detail.includes("write-workspace") && refusal.detail.includes("execute-command"));
		});

		test("execute-command without riskAcknowledged fails with E_HIGH_RISK_UNACKNOWLEDGED (the gate-owned law)", async function () {
			const seed = await seedEntry({ permissions: ["execute-command"] });
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["execute-command"] }));
			assert.strictEqual(refusal.code, "E_HIGH_RISK_UNACKNOWLEDGED");
			assert.strictEqual(refusal.law, GATE_REFUSALS.E_HIGH_RISK_UNACKNOWLEDGED.law);
			assert.strictEqual(refusal.source, "gate");
		});

		test("network-access without riskAcknowledged fails with E_HIGH_RISK_UNACKNOWLEDGED", async function () {
			const seed = await seedEntry({ permissions: ["network-access"] });
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["network-access"] }));
			assert.strictEqual(refusal.code, "E_HIGH_RISK_UNACKNOWLEDGED");
		});

		test("execute-command with riskAcknowledged: true is recorded", async function () {
			const seed = await seedEntry({ permissions: ["execute-command"] });
			const gate = await gateOn(seed);
			const outcome = await gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["execute-command"], riskAcknowledged: true });
			assert.strictEqual(outcome.recorded.riskAcknowledged, true);
			assert.deepStrictEqual([...outcome.recorded.highRiskPermissions], ["execute-command"]);
		});

		test("network-access with riskAcknowledged: true is recorded", async function () {
			const seed = await seedEntry({ permissions: ["network-access"] });
			const gate = await gateOn(seed);
			const outcome = await gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["network-access"], riskAcknowledged: true });
			assert.strictEqual(outcome.recorded.riskAcknowledged, true);
		});

		test("a truthy but non-true riskAcknowledged is refused (explicit true is required)", async function () {
			const seed = await seedEntry({ permissions: ["execute-command"] });
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["execute-command"], riskAcknowledged: "yes" }));
			assert.strictEqual(refusal.code, "E_HIGH_RISK_UNACKNOWLEDGED");
			const refusal2 = await expectRefusal(gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["execute-command"], riskAcknowledged: 1 }));
			assert.strictEqual(refusal2.code, "E_HIGH_RISK_UNACKNOWLEDGED");
		});

		test("low and moderate permissions need no risk acknowledgement", async function () {
			const seed = await seedEntry({ permissions: ["read-files", "write-workspace"] });
			const gate = await gateOn(seed);
			const outcome = await gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["read-files", "write-workspace"] });
			assert.deepStrictEqual([...outcome.recorded.highRiskPermissions], []);
		});

		test("malformed decisions fail with E_APPROVAL_MALFORMED (verbatim law)", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			for (const bad of [null, [], {}, { approver: "" }, { approver: "op-a" }, { approver: "op-a", acknowledgedPermissions: "read-files" }] as unknown[]) {
				const refusal = await expectRefusal(gate.decidePermissions(seed.entryId, bad as GateDecisionInput));
				assert.strictEqual(refusal.code, "E_APPROVAL_MALFORMED");
				assert.strictEqual(refusal.law, REFUSALS.E_APPROVAL_MALFORMED.law);
			}
		});

		test("a decision for an unknown entry fails with E_ENTRY_UNKNOWN", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.decidePermissions("e-nonexistent", { approver: "op-a", acknowledgedPermissions: [] }));
			assert.strictEqual(refusal.code, "E_ENTRY_UNKNOWN");
		});

		test("a decision on a discovered (pre-import) entry is recorded as evidence with empty declared permissions", async function () {
			const seed = await seedEntry({ register: false });
			const gate = await gateOn(seed);
			const outcome = await gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: [] });
			assert.strictEqual(outcome.state, "discovered");
			assert.deepStrictEqual([...outcome.recorded.declaredPermissions], []);
		});

		test("the latest decision wins: approve submits the second decision", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			await gate.decidePermissions(seed.entryId, { approver: "op-first", acknowledgedPermissions: ["read-files"] });
			await gate.decidePermissions(seed.entryId, { approver: "op-second", acknowledgedPermissions: ["read-files"] });
			await gate.approve(seed.entryId);
			const witness = await witnessFor(seed.root, seed.clock.clock);
			const inspected = await witness.inspect(seed.entryId);
			if (inspected.ok !== true) {
				assert.fail("inspect must succeed");
			}
			assert.strictEqual(inspected.entry.approval?.approver, "op-second");
		});

		test("gate risk tiers equal the frozen ZC-006 catalog table (CR-008 3c paste)", async function () {
			assert.deepStrictEqual(GATE_PERMISSION_RISK_TIERS, {
				"read-files": "low",
				"execute-command": "high",
				"network-access": "high",
				"write-workspace": "moderate"
			});
		});
	});

	suite("approve and enable flows", function () {
		test("approve submits the recorded decision; the registry's own approval record is exact", async function () {
			const seed = await seedEntry({ permissions: ["read-files", "write-workspace"] });
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			seed.clock.advance();
			await gate.decidePermissions(seed.entryId, { approver: "op-50", acknowledgedPermissions: ["write-workspace", "read-files"] });
			seed.clock.advance();
			const approved = await gate.approve(seed.entryId);
			assert.strictEqual(approved.state, "approved");
			const witness = await witnessFor(seed.root, seed.clock.clock);
			const inspected = await witness.inspect(seed.entryId);
			if (inspected.ok !== true) {
				assert.fail("inspect must succeed");
			}
			assert.notStrictEqual(inspected.entry.approval, null);
			assert.strictEqual(inspected.entry.approval?.approver, "op-50");
			assert.deepStrictEqual([...(inspected.entry.approval?.acknowledgedPermissions ?? [])], ["read-files", "write-workspace"]);
			assert.strictEqual(inspected.entry.approval?.scope.workspaceId, SCOPE.workspaceId);
			/* station seam-fix: the shared injected clock reads register@1001000,
			 * decide@1002000, approve@1003000 — the registry stamps at the CURRENT
			 * clock on each call; the original 1004000 expectation miscounted one
			 * tick (no advance between verify and decide). */
			assert.strictEqual(inspected.entry.approval?.at, 1003000);
		});

		test("approve without a recorded decision fails with E_APPROVAL_MALFORMED, source gate", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			const refusal = await expectRefusal(gate.approve(seed.entryId));
			assert.strictEqual(refusal.code, "E_APPROVAL_MALFORMED");
			assert.strictEqual(refusal.law, REFUSALS.E_APPROVAL_MALFORMED.law);
			assert.strictEqual(refusal.source, "gate");
			assert.ok(refusal.detail !== null && refusal.detail.includes("decidePermissions"));
		});

		test("approve before verified fails with E_APPROVE_REQUIRES_VERIFIED (verbatim law)", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["read-files"] });
			const refusal = await expectRefusal(gate.approve(seed.entryId));
			assert.strictEqual(refusal.code, "E_APPROVE_REQUIRES_VERIFIED");
			assert.strictEqual(refusal.law, REFUSALS.E_APPROVE_REQUIRES_VERIFIED.law);
			assert.strictEqual(refusal.source, "registry");
		});

		test("pre-check equivalence: the gate's acknowledgement refusal equals the registry's own for the same mismatch", async function () {
			const seed = await seedEntry({ permissions: ["read-files", "write-workspace"] });
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			const witness = await witnessFor(seed.root, seed.clock.clock);
			const registryOutcome = await witness.approve(seed.entryId, { approver: "op-x", acknowledgedPermissions: ["read-files"] });
			if (registryOutcome.ok) {
				assert.fail("the witness approve must refuse the mismatch");
			}
			const gateRefusal = await expectRefusal(gate.decidePermissions(seed.entryId, { approver: "op-x", acknowledgedPermissions: ["read-files"] }));
			assert.strictEqual(gateRefusal.code, registryOutcome.refusal.code);
			assert.strictEqual(gateRefusal.law, registryOutcome.refusal.law);
			assert.strictEqual(gateRefusal.detail, registryOutcome.refusal.detail);
		});

		test("a decision recorded pre-import then registered: the approve pre-check fires without calling the registry", async function () {
			const seed = await seedEntry({ register: false });
			const gate = await gateOn(seed);
			const decision = await gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: [] });
			assert.strictEqual(decision.state, "discovered");
			const registered = await seed.registry.register({
				entryId: seed.entryId,
				digest: seed.contentHash,
				version: "1.0.0",
				license: "Apache-2.0",
				permissions: ["read-files"],
				endpoints: [],
				platforms: ["darwin-arm64"],
				artifactKind: "cli",
				provenance: { seed: "preimport" }
			});
			if (registered.ok !== true) {
				assert.fail("register must succeed");
			}
			const gate2 = await loadGate(seed.root, { clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE });
			await gate2.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			const journalMid = await fsp.readFile(journalPath(seed.root), "utf8");
			const recordsMid = await fsp.readFile(gateRecordsPath(seed.root), "utf8");
			const refusal = await expectRefusal(gate2.approve(seed.entryId));
			assert.strictEqual(refusal.code, "E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH");
			assert.strictEqual(refusal.source, "gate");
			assert.strictEqual(await fsp.readFile(journalPath(seed.root), "utf8"), journalMid);
			assert.strictEqual(await fsp.readFile(gateRecordsPath(seed.root), "utf8"), recordsMid);
		});

		test("enable on a clean history: enabled, no warning, no warning record", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			await gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["read-files"] });
			await gate.approve(seed.entryId);
			const enabled = await gate.enable(seed.entryId);
			assert.strictEqual(enabled.state, "enabled");
			assert.strictEqual(enabled.warning, null);
			assert.deepStrictEqual((await readGateRecords(seed.root)).map((record) => record.kind), ["receipt", "decision"]);
		});

		test("enable with a verified-partial history: enabled with a durable warning carrying the census", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified-partial", checks: [{ checkId: "sig", verdict: "pass" }] });
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			await gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["read-files"] });
			await gate.approve(seed.entryId);
			const enabled = await gate.enable(seed.entryId);
			assert.strictEqual(enabled.state, "enabled");
			assert.notStrictEqual(enabled.warning, null);
			assert.strictEqual(enabled.warning?.code, "W_ENABLE_VERIFICATION_PARTIAL");
			assert.strictEqual(enabled.warning?.census.receiptCount, 2);
			assert.strictEqual(enabled.warning?.census.partialReceiptCount, 1);
			assert.deepStrictEqual([...enabled.warning?.census.partialChecks ?? []], [{ checkId: "sig", verdict: "pass" }]);
		});

		test("enable before approval fails with E_ENABLE_REQUIRES_APPROVED (the verbatim auto-trust prohibition law)", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			await gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["read-files"] });
			const refusal = await expectRefusal(gate.enable(seed.entryId));
			assert.strictEqual(refusal.code, "E_ENABLE_REQUIRES_APPROVED");
			assert.strictEqual(refusal.law, "enabling anything not approved is a typed refusal; the discover-to-install-to-auto-trust path is forbidden and fails closed (CR-006 2a).");
			assert.strictEqual(refusal.law, REFUSALS.E_ENABLE_REQUIRES_APPROVED.law);
			assert.strictEqual(refusal.source, "registry");
		});

		test("enable for an unknown entry fails with E_ENTRY_UNKNOWN", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const refusal = await expectRefusal(gate.enable("e-nonexistent"));
			assert.strictEqual(refusal.code, "E_ENTRY_UNKNOWN");
		});

		test("enable on a revoked entry after an external remove and a restart fails with E_REVOKED_TERMINAL", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			await gate.decidePermissions(seed.entryId, { approver: "op-a", acknowledgedPermissions: ["read-files"] });
			await gate.approve(seed.entryId);
			await gate.enable(seed.entryId);
			const witness = await witnessFor(seed.root, seed.clock.clock);
			const removed = await witness.remove(seed.entryId, "cr008-test-revoke");
			if (removed.ok !== true) {
				assert.fail("remove must succeed");
			}
			const gate2 = await loadGate(seed.root, { clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE });
			const refusal = await expectRefusal(gate2.enable(seed.entryId));
			assert.strictEqual(refusal.code, "E_REVOKED_TERMINAL");
			assert.strictEqual(refusal.law, REFUSALS.E_REVOKED_TERMINAL.law);
			assert.strictEqual(refusal.source, "registry");
		});
	});

	suite("the policy summary projection", function () {
		test("the summary is the full fail-closed projection (deep-equal, injected-clock stamps)", async function () {
			const seed = await seedEntry({ permissions: ["read-files", "execute-command"] });
			const gate = await gateOn(seed);
			seed.clock.advance();
			await gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified-partial", checks: [{ checkId: "sig", verdict: "pass" }] });
			seed.clock.advance();
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			seed.clock.advance();
			await gate.decidePermissions(seed.entryId, { approver: "op-flagship", acknowledgedPermissions: ["execute-command", "read-files"], riskAcknowledged: true });
			seed.clock.advance();
			await gate.approve(seed.entryId);
			seed.clock.advance();
			await gate.enable(seed.entryId);
			const summary = await gate.gatePolicySummary(seed.entryId);
			assert.deepStrictEqual(summary, {
				entryId: seed.entryId,
				state: "enabled",
				contentHash: seed.contentHash,
				createdAt: 1000000,
				updatedAt: 1006000,
				unavailableCause: null,
				declaredPermissions: [
					{ id: "read-files", riskTier: "low" },
					{ id: "execute-command", riskTier: "high" }
				],
				highRiskPermissions: ["execute-command"],
				verification: {
					status: "verified",
					receiptCount: 2,
					receiptsByStatus: { unverified: 0, verified: 1, "verified-partial": 1, "verification-failed": 0 },
					partialChecks: [{ checkId: "sig", verdict: "pass" }]
				},
				approval: {
					approver: "op-flagship",
					acknowledgedPermissions: ["execute-command", "read-files"],
					at: 1005000,
					scope: SCOPE
				},
				gateDecisions: [
					{
						approver: "op-flagship",
						acknowledgedPermissions: ["execute-command", "read-files"],
						riskAcknowledged: true,
						declaredPermissions: ["read-files", "execute-command"],
						highRiskPermissions: ["execute-command"],
						at: 1004000
					}
				],
				gateWarnings: [
					{
						code: "W_ENABLE_VERIFICATION_PARTIAL",
						note: GATE_WARNINGS.W_ENABLE_VERIFICATION_PARTIAL.note,
						entryId: seed.entryId,
						at: 1006000,
						census: { receiptCount: 2, partialReceiptCount: 1, partialChecks: [{ checkId: "sig", verdict: "pass" }] }
					}
				]
			});
			const records = await readGateRecords(seed.root);
			assert.deepStrictEqual(records.map((record) => record.kind), ["receipt", "receipt", "decision", "warning"]);
			assert.deepStrictEqual(records.map((record) => record.seq), [1, 2, 3, 4]);
			assert.deepStrictEqual(records.map((record) => record.at), [1002000, 1003000, 1004000, 1006000]);
		});

		test("risk tiers per permission follow the frozen catalog (all four declared)", async function () {
			const seed = await seedEntry({ permissions: ["read-files", "execute-command", "network-access", "write-workspace"] });
			const gate = await gateOn(seed);
			const summary = await gate.gatePolicySummary(seed.entryId);
			assert.deepStrictEqual([...summary.declaredPermissions], [
				{ id: "read-files", riskTier: "low" },
				{ id: "execute-command", riskTier: "high" },
				{ id: "network-access", riskTier: "high" },
				{ id: "write-workspace", riskTier: "moderate" }
			]);
			assert.deepStrictEqual([...summary.highRiskPermissions], ["execute-command", "network-access"]);
		});

		test("a fresh imported entry projects the minimal summary", async function () {
			const seed = await seedEntry();
			const gate = await gateOn(seed);
			const summary = await gate.gatePolicySummary(seed.entryId);
			assert.strictEqual(summary.state, "imported");
			assert.strictEqual(summary.approval, null);
			assert.deepStrictEqual([...summary.gateDecisions], []);
			assert.deepStrictEqual([...summary.gateWarnings], []);
			assert.strictEqual(summary.verification.receiptCount, 0);
		});

		test("a summary for an unknown entry fails with E_ENTRY_UNKNOWN", async function () {
			const root = await freshRoot();
			const clock = makeClock();
			const gate = await createGate({ root: root, clock: clock.clock, fsPort: realFsPort, scope: SCOPE });
			const refusal = await expectRefusal(gate.gatePolicySummary("e-nonexistent"));
			assert.strictEqual(refusal.code, "E_ENTRY_UNKNOWN");
		});

		test("purity: the summary performs zero writes and changes no bytes", async function () {
			const seed = await seedEntry();
			const counting = countingFsPort(realFsPort);
			const gate = await createGate({ root: seed.root, clock: seed.clock.clock, fsPort: counting.port, scope: SCOPE });
			await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			await gate.decidePermissions(seed.entryId, { approver: "op-purity", acknowledgedPermissions: ["read-files"] });
			const before = { ...counting.counts };
			const journalBefore = await fsp.readFile(journalPath(seed.root), "utf8");
			const recordsBefore = await fsp.readFile(gateRecordsPath(seed.root), "utf8");
			const summary = await gate.gatePolicySummary(seed.entryId);
			assert.strictEqual(summary.state, "verified");
			assert.strictEqual(counting.counts.writeFile, before.writeFile);
			assert.strictEqual(counting.counts.appendFile, before.appendFile);
			assert.strictEqual(counting.counts.mkdir, before.mkdir);
			/* station seam-fix: the summary reads through registry.inspect — the
			 * authority's maintained in-memory state, not a fresh disk read. The
			 * fs-read-count expectation was over-specified; freshness is pinned by
			 * the state assertion above (the summary reflects the latest ops). */
			assert.strictEqual(await fsp.readFile(journalPath(seed.root), "utf8"), journalBefore);
			assert.strictEqual(await fsp.readFile(gateRecordsPath(seed.root), "utf8"), recordsBefore);
		});
	});

	suite("restart replay and determinism", function () {
		test("restart replay: a reloaded gate projects the identical policy summary", async function () {
			const seed = await seedEntry({ permissions: ["read-files", "execute-command"] });
			const gate1 = await gateOn(seed);
			await gate1.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified-partial", checks: [{ checkId: "sig", verdict: "pass" }] });
			seed.clock.advance();
			await gate1.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			seed.clock.advance();
			await gate1.decidePermissions(seed.entryId, { approver: "op-restart", acknowledgedPermissions: ["read-files", "execute-command"], riskAcknowledged: true });
			seed.clock.advance();
			await gate1.approve(seed.entryId);
			seed.clock.advance();
			await gate1.enable(seed.entryId);
			const summary1 = await gate1.gatePolicySummary(seed.entryId);
			const gate2 = await loadGate(seed.root, { clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE });
			const summary2 = await gate2.gatePolicySummary(seed.entryId);
			assert.deepStrictEqual(summary2, summary1);
		});

		test("determinism: two identical runs produce byte-identical journals, snapshots, and gate records", async function () {
			const runFlow = async (root: string): Promise<void> => {
				const clock = makeClock();
				const registry = createRegistry({ root: root, clock: clock.clock, fsPort: realFsPort, scope: SCOPE });
				const load = await registry.load();
				if (load.ok !== true) {
					assert.fail("load must succeed");
				}
				const discovery = await registry.discover({ sourceKind: "user-spec", artifactKind: "cli", contentHash: "sha256-cr008-determinism", version: "1.2.3" });
				if (discovery.ok !== true) {
					assert.fail("discover must succeed");
				}
				clock.advance();
				const registered = await registry.register({
					entryId: discovery.entryId,
					digest: "sha256-cr008-determinism",
					version: "1.2.3",
					license: "MIT",
					permissions: ["read-files", "execute-command"],
					endpoints: [],
					platforms: ["linux-x64"],
					artifactKind: "cli",
					provenance: { seed: "cr008" }
				});
				if (registered.ok !== true) {
					assert.fail("register must succeed");
				}
				const gate = await createGate({ root: root, clock: clock.clock, fsPort: realFsPort, scope: SCOPE });
				clock.advance();
				const partial = await gate.submitVerificationReceipt(registered.entryId, { verificationStatus: "verified-partial", checks: [{ checkId: "sig", verdict: "pass" }] });
				if (partial.ok !== true) {
					assert.fail("partial must succeed");
				}
				clock.advance();
				const verified = await gate.submitVerificationReceipt(registered.entryId, { verificationStatus: "verified", checks: [{ checkId: "sig", verdict: "pass" }, { checkId: "manifest", verdict: "pass" }] });
				if (verified.ok !== true) {
					assert.fail("verified must succeed");
				}
				clock.advance();
				const decision = await gate.decidePermissions(registered.entryId, { approver: "op-cr008", acknowledgedPermissions: ["read-files", "execute-command"], riskAcknowledged: true });
				if (decision.ok !== true) {
					assert.fail("decision must succeed");
				}
				clock.advance();
				const approval = await gate.approve(registered.entryId);
				if (approval.ok !== true) {
					assert.fail("approve must succeed");
				}
				clock.advance();
				const enabled = await gate.enable(registered.entryId);
				if (enabled.ok !== true) {
					assert.fail("enable must succeed");
				}
				assert.notStrictEqual(enabled.warning, null);
			};
			const rootA = await freshRoot();
			const rootB = await freshRoot();
			await runFlow(rootA);
			await runFlow(rootB);
			for (const name of ["registry-journal.jsonl", "registry-state.json", join(".flauz", "gate", "records.jsonl")]) {
				const a = await fsp.readFile(join(rootA, name), "utf8");
				const b = await fsp.readFile(join(rootB, name), "utf8");
				assert.strictEqual(a, b, name + " must be byte-identical across runs");
			}
		});

		test("gate records structure: contiguous sequences, contract version, scope, evidence kinds only", async function () {
			const seed = await seedEntry({ permissions: ["network-access"] });
			const gate = await gateOn(seed);
			await gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified-partial", checks: [{ checkId: "sig", verdict: "pass" }] });
			await gate.submitVerificationReceipt(seed.entryId, { verificationStatus: "verified", checks: [{ checkId: "sig", verdict: "pass" }] });
			await gate.decidePermissions(seed.entryId, { approver: "op-structure", acknowledgedPermissions: ["network-access"], riskAcknowledged: true });
			await gate.approve(seed.entryId);
			await gate.enable(seed.entryId);
			const records = await readGateRecords(seed.root);
			for (let index = 0; index < records.length; index++) {
				assert.strictEqual(records[index].seq, index + 1);
				assert.strictEqual(records[index].contractVersion, GATE_CONTRACT_VERSION);
				assert.deepStrictEqual(records[index].scope, SCOPE);
				assert.strictEqual(records[index].entryId, seed.entryId);
				assert.ok(records[index].kind === "receipt" || records[index].kind === "decision" || records[index].kind === "warning");
			}
			assert.deepStrictEqual(records.map((record) => record.kind), ["receipt", "receipt", "decision", "warning"]);
		});
	});

	suite("integration smoke: one journal, no shadow state", function () {
		test("discover->register (registry) then verify->approve->enable (gate): the registry's own view matches", async function () {
			const seed = await seedEntry({ permissions: ["read-files", "network-access"] });
			const gate = await gateOn(seed);
			const verified = await gate.submitVerificationReceipt(seed.entryId, verifiedReceipt());
			assert.strictEqual(verified.state, "verified");
			const decision = await gate.decidePermissions(seed.entryId, { approver: "op-smoke", acknowledgedPermissions: ["read-files", "network-access"], riskAcknowledged: true });
			assert.strictEqual(decision.state, "verified");
			const approved = await gate.approve(seed.entryId);
			assert.strictEqual(approved.state, "approved");
			const enabled = await gate.enable(seed.entryId);
			assert.strictEqual(enabled.state, "enabled");
			const witness = createRegistry({ root: seed.root, clock: seed.clock.clock, fsPort: realFsPort, scope: SCOPE });
			const witnessLoad = await witness.load();
			if (witnessLoad.ok !== true || witnessLoad.recovered !== null) {
				assert.fail("witness load must replay cleanly with no recovery");
			}
			const query = await witness.query({ state: "enabled" });
			if (query.ok !== true) {
				assert.fail("query must succeed");
			}
			assert.strictEqual(query.count, 1);
			assert.strictEqual(query.entries[0].entryId, seed.entryId);
			const inspected = await witness.inspect(seed.entryId);
			if (inspected.ok !== true) {
				assert.fail("inspect must succeed");
			}
			assert.deepStrictEqual(inspected.entry.transitions.map((note) => note.op), ["discover", "register", "verify", "approve", "enable"]);
			assert.strictEqual(inspected.entry.verification.status, "verified");
			assert.strictEqual(inspected.entry.approval?.approver, "op-smoke");
			const journalText = await fsp.readFile(journalPath(seed.root), "utf8");
			assert.strictEqual(journalText.split("\n").filter((line) => line !== "").length, 5);
			const gateRecords = await readGateRecords(seed.root);
			assert.strictEqual(gateRecords.length, 2);
			for (const record of gateRecords) {
				assert.ok(record.kind === "receipt" || record.kind === "decision" || record.kind === "warning", "gate records must be evidence only");
			}
			const gateDirEntries = await fsp.readdir(join(seed.root, ".flauz", "gate"));
			assert.deepStrictEqual(gateDirEntries, ["records.jsonl"]);
		});

		test("behavioral risk-tier cross-pin: the registry's permissionTier query view matches the gate's high-risk law", async function () {
			const root = await freshRoot();
			const clock = makeClock();
			const registry = createRegistry({ root: root, clock: clock.clock, fsPort: realFsPort, scope: SCOPE });
			const load = await registry.load();
			if (load.ok !== true) {
				assert.fail("load must succeed");
			}
			const highDiscovery = await registry.discover({ sourceKind: "user-spec", artifactKind: "cli", contentHash: "sha256-cr008-high", version: "1.0.0" });
			if (highDiscovery.ok !== true) {
				assert.fail("discover high must succeed");
			}
			const highRegistered = await registry.register({ entryId: highDiscovery.entryId, digest: "sha256-cr008-high", version: "1.0.0", license: "MIT", permissions: ["execute-command"], endpoints: [], platforms: ["linux-x64"], artifactKind: "cli", provenance: { seed: "high" } });
			if (highRegistered.ok !== true) {
				assert.fail("register high must succeed");
			}
			const lowDiscovery = await registry.discover({ sourceKind: "user-spec", artifactKind: "cli", contentHash: "sha256-cr008-lowmod", version: "1.0.0" });
			if (lowDiscovery.ok !== true) {
				assert.fail("discover low must succeed");
			}
			const lowRegistered = await registry.register({ entryId: lowDiscovery.entryId, digest: "sha256-cr008-lowmod", version: "1.0.0", license: "MIT", permissions: ["read-files", "write-workspace"], endpoints: [], platforms: ["linux-x64"], artifactKind: "cli", provenance: { seed: "lowmod" } });
			if (lowRegistered.ok !== true) {
				assert.fail("register low must succeed");
			}
			const highTier = await registry.query({ permissionTier: "high" });
			if (highTier.ok !== true) {
				assert.fail("query high must succeed");
			}
			assert.deepStrictEqual(highTier.entries.map((entry) => entry.entryId), [highRegistered.entryId]);
			const moderateTier = await registry.query({ permissionTier: "moderate" });
			if (moderateTier.ok !== true) {
				assert.fail("query moderate must succeed");
			}
			assert.deepStrictEqual(moderateTier.entries.map((entry) => entry.entryId), [lowRegistered.entryId]);
			const gate = await createGate({ root: root, clock: clock.clock, fsPort: realFsPort, scope: SCOPE });
			const highRefusal = await expectRefusal(gate.decidePermissions(highRegistered.entryId, { approver: "op-x", acknowledgedPermissions: ["execute-command"] }));
			assert.strictEqual(highRefusal.code, "E_HIGH_RISK_UNACKNOWLEDGED");
			const lowDecision = await gate.decidePermissions(lowRegistered.entryId, { approver: "op-x", acknowledgedPermissions: ["read-files", "write-workspace"] });
			assert.strictEqual(lowDecision.recorded.riskAcknowledged, false);
			assert.deepStrictEqual([...lowDecision.recorded.highRiskPermissions], []);
		});
	});
});