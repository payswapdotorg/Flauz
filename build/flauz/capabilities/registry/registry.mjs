/* ------------------------------------------------------------------ */
/* Flauz Capability Exchange - CR-006 registry runtime (B2, wave 1).  */
/*                                                                     */
/* MIT License                                                         */
/*                                                                     */
/* Copyright (c) Flauz contributors.                                   */
/*                                                                     */
/* Permission is hereby granted, free of charge, to any person        */
/* obtaining a copy of this software and associated documentation     */
/* files (the "Software"), to deal in the Software without            */
/* restriction, including without limitation the rights to use,       */
/* copy, modify, merge, publish, distribute, sublicense, and/or sell   */
/* copies of the Software, and to permit persons to whom the Software  */
/* is furnished to do so, subject to the following conditions:        */
/*                                                                     */
/* The above copyright notice and this permission notice shall be     */
/* included in all copies or substantial portions of the Software.    */
/*                                                                     */
/* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,     */
/* EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF  */
/* MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND               */
/* NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT         */
/* HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,        */
/* WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,  */
/* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER       */
/* DEALINGS IN THE SOFTWARE.                                           */
/* ------------------------------------------------------------------ */
/* The persisted registry runtime: append-only JSONL journal,         */
/* snapshot cross-check, injected clock and fs port, restart          */
/* recovery, and the eleven ruled operations, every one routed        */
/* through the pure machine in state.mjs.                             */
/* ------------------------------------------------------------------ */

import {
	REGISTRY_CONTRACT_VERSION,
	INITIAL_STATES,
	REGISTRY_STATES,
	ARTIFACT_KINDS,
	PLATFORMS,
	RISK_TIERS,
	SOURCE_KINDS,
	applyTransition,
	importViolation,
	verificationStatusFor,
	permissionTier,
	refusalFor,
	disclosureFor,
	canonicalJSON,
	sha256Hex,
	isRegistryState,
	isSourceKind,
	isArtifactKind,
	showValue
} from "./state.mjs";

export * from "./state.mjs";

const JOURNAL_NAME = "registry-journal.jsonl";
const SNAPSHOT_NAME = "registry-state.json";

function requireString(holder, key, where) {
	const value = holder[key];
	if (typeof value !== "string" || value === "") {
		throw new TypeError(where + ": " + key + " must be a non-empty string");
	}
	return value;
}

function sanitize(value) {
	return JSON.parse(canonicalJSON(value));
}

function noteFrom(record) {
	return { seq: record.seq, at: record.at, op: record.op, fromState: record.fromState, toState: record.toState };
}

function makeEntryRecord(record) {
	const payload = record.payload || {};
	return {
		entryId: record.entryId,
		contentHash: payload.contentHash !== undefined ? payload.contentHash : (payload.imported !== undefined ? payload.imported.digest : null),
		state: record.toState,
		createdAt: record.at,
		updatedAt: record.at,
		discovery: payload.discovery !== undefined ? payload.discovery : null,
		imported: payload.imported !== undefined ? payload.imported : null,
		verification: { status: "unverified", receipts: [] },
		approval: null,
		unavailableCause: null,
		lineage: { predecessor: payload.predecessor !== undefined ? payload.predecessor : null },
		revocation: null,
		transitions: [noteFrom(record)]
	};
}

/* The single reducer shared by live operations and journal replay.  */

function applyRecordTo(entries, record) {
	const payload = record.payload || {};
	if (record.op === "discover" || record.op === "update") {
		entries.set(record.entryId, makeEntryRecord(record));
		return;
	}
	const entry = entries.get(record.entryId);
	if (entry === undefined) {
		throw new Error("journal record references an unknown entry: " + record.entryId);
	}
	entry.updatedAt = record.at;
	switch (record.op) {
		case "register":
			entry.imported = payload.imported;
			break;
		case "verify":
			entry.verification.receipts.push(payload.receipt);
			entry.verification.status = verificationStatusFor(payload.receipt);
			if (record.toState === "unavailable") {
				entry.unavailableCause = "verification-failed";
			}
			break;
		case "approve":
			entry.approval = payload.decision;
			break;
		case "enable":
			break;
		case "disable":
			entry.unavailableCause = payload.cause === undefined ? "disabled-by-operator" : payload.cause;
			break;
		case "project":
			entry.unavailableCause = payload.cause === undefined ? null : payload.cause;
			break;
		case "remove":
			entry.revocation = { reason: payload.reason === undefined ? null : payload.reason, at: record.at };
			break;
		default:
			throw new Error("journal record carries an unknown op: " + record.op);
	}
	if (record.toState !== record.fromState) {
		entry.state = record.toState;
		entry.transitions.push(noteFrom(record));
	}
}

export function createRegistry(options) {
	if (options === null || typeof options !== "object") {
		throw new TypeError("createRegistry requires an options object");
	}
	const root = requireString(options, "root", "createRegistry").replace(/\/+$/, "");
	if (typeof options.clock !== "function") {
		throw new TypeError("createRegistry: clock must be a function");
	}
	const clock = options.clock;
	const fsPort = options.fsPort;
	if (fsPort === null || typeof fsPort !== "object") {
		throw new TypeError("createRegistry: fsPort must be an object");
	}
	for (const name of ["readFile", "writeFile", "appendFile", "mkdir", "readdir"]) {
		if (typeof fsPort[name] !== "function") {
			throw new TypeError("createRegistry: fsPort." + name + " must be a function");
		}
	}
	if (options.scope === null || typeof options.scope !== "object") {
		throw new TypeError("createRegistry: scope must be { workspaceId, tenantId }");
	}
	const scopeCopy = Object.freeze({
		workspaceId: requireString(options.scope, "workspaceId", "scope"),
		tenantId: requireString(options.scope, "tenantId", "scope")
	});
	const journalPath = root + "/" + JOURNAL_NAME;
	const snapshotPath = root + "/" + SNAPSHOT_NAME;

	let loaded = false;
	let seq = 0;
	let entries = new Map();

	function refused(code, context) {
		return { ok: false, refusal: refusalFor(code, context) };
	}

	function refused0(code, context) {
		return refused(code, context);
	}

	function requireLoaded() {
		if (!loaded) {
			return refusalFor("E_NOT_LOADED", {});
		}
		return null;
	}

	async function readText(path) {
		try {
			return await fsPort.readFile(path, "utf8");
		} catch (err) {
			if (err !== null && typeof err === "object" && err.code === "ENOENT") {
				return null;
			}
			throw err;
		}
	}

	function makeRecord(op, entryId, fromState, toState, payload) {
		return {
			seq: seq + 1,
			at: clock(),
			scope: scopeCopy,
			contractVersion: REGISTRY_CONTRACT_VERSION,
			op: op,
			entryId: entryId,
			fromState: fromState,
			toState: toState,
			payload: payload
		};
	}

	function applyRecord(record) {
		seq = record.seq;
		applyRecordTo(entries, record);
	}

	function buildSnapshotState() {
		return { contractVersion: REGISTRY_CONTRACT_VERSION, scope: scopeCopy, seq: seq, entries: [...entries.values()] };
	}

	async function persist(record) {
		await fsPort.appendFile(journalPath, canonicalJSON(record) + "\n");
		await fsPort.writeFile(snapshotPath, canonicalJSON(buildSnapshotState()));
	}

	function machineInputFor(record, replayEntries) {
		const payload = record.payload || {};
		if (record.op === "verify") {
			return payload.receipt === undefined ? {} : payload.receipt;
		}
		if (record.op === "register") {
			return payload.imported === undefined ? {} : payload.imported;
		}
		if (record.op === "project") {
			const facts = payload.facts || {};
			const entry = replayEntries.get(record.entryId);
			return {
				platformMatch: facts.platformMatch,
				dependenciesPresent: facts.dependenciesPresent,
				cause: entry === undefined ? null : entry.unavailableCause
			};
		}
		return {};
	}

	function validateJournalRecord(record, lineNo, replayEntries) {
		if (record === null || typeof record !== "object" || Array.isArray(record)) {
			return refused0("E_JOURNAL_TORN", { detail: "journal line " + lineNo + " is not a JSON object" });
		}
		if (typeof record.seq !== "number" || !Number.isInteger(record.seq) || record.seq !== lineNo) {
			return refused0("E_JOURNAL_TORN", { detail: "journal line " + lineNo + " has sequence " + showValue(record.seq) + "; journal lines are missing or out of order" });
		}
		if (typeof record.at !== "number" || !Number.isFinite(record.at)) {
			return refused0("E_JOURNAL_TORN", { detail: "journal line " + lineNo + " has no finite timestamp" });
		}
		if (record.scope === null || typeof record.scope !== "object" || record.scope.workspaceId !== scopeCopy.workspaceId || record.scope.tenantId !== scopeCopy.tenantId) {
			return refused0("E_SNAPSHOT_MISMATCH", { detail: "journal line " + lineNo + " belongs to a different scope" });
		}
		if (record.contractVersion !== REGISTRY_CONTRACT_VERSION) {
			return refused0("E_SNAPSHOT_MISMATCH", { detail: "journal line " + lineNo + " carries contract version " + showValue(record.contractVersion) });
		}
		if (typeof record.op !== "string" || typeof record.entryId !== "string" || record.entryId === "") {
			return refused0("E_JOURNAL_TORN", { detail: "journal line " + lineNo + " is structurally invalid" });
		}
		if (record.fromState === null) {
			if (INITIAL_STATES[record.op] !== record.toState) {
				return refused0("E_JOURNAL_UNLAWFUL", { detail: "journal line " + lineNo + ": " + record.op + " does not create an entry in state " + showValue(record.toState) });
			}
			if (replayEntries.has(record.entryId)) {
				return refused0("E_JOURNAL_UNLAWFUL", { detail: "journal line " + lineNo + ": creation of an entry that already exists" });
			}
			return null;
		}
		if (!isRegistryState(record.fromState) || !isRegistryState(record.toState)) {
			return refused0("E_JOURNAL_TORN", { detail: "journal line " + lineNo + " carries an unknown lifecycle state" });
		}
		if (!replayEntries.has(record.entryId)) {
			return refused0("E_JOURNAL_UNLAWFUL", { detail: "journal line " + lineNo + " references an entry that does not exist at that point in the journal" });
		}
		const machineResult = applyTransition(record.fromState, record.op, machineInputFor(record, replayEntries));
		let lawful = machineResult.ok;
		if (lawful) {
			if (machineResult.disclosure !== undefined && machineResult.disclosure !== null) {
				lawful = record.toState === record.fromState && machineResult.nextState === record.fromState;
			} else {
				lawful = machineResult.nextState === record.toState;
			}
		}
		if (!lawful) {
			return refused0("E_JOURNAL_UNLAWFUL", { detail: "journal line " + lineNo + ": the pure machine does not grant " + record.op + " " + record.fromState + " -> " + record.toState });
		}
		return null;
	}

	function commit(nextEntries, nextSeq) {
		entries = nextEntries;
		seq = nextSeq;
		loaded = true;
	}

	async function loadImpl() {
		await fsPort.mkdir(root, { recursive: true });
		const journalText = await readText(journalPath);
		const replayEntries = new Map();
		let replaySeq = 0;
		if (journalText !== null && journalText !== "") {
			if (journalText.charAt(journalText.length - 1) !== "\n") {
				return refused0("E_JOURNAL_TORN", { detail: "the journal does not end with a complete line" });
			}
			const lines = journalText.split("\n");
			if (lines.length > 0 && lines[lines.length - 1] === "") {
				lines.pop();
			}
			for (let index = 0; index < lines.length; index++) {
				const raw = lines[index];
				if (raw === "") {
					return refused0("E_JOURNAL_TORN", { detail: "journal line " + (index + 1) + " is empty" });
				}
				let record = null;
				try {
					record = JSON.parse(raw);
				} catch (err) {
					return refused0("E_JOURNAL_TORN", { detail: "journal line " + (index + 1) + " is not valid JSON" });
				}
				const checked = validateJournalRecord(record, index + 1, replayEntries);
				if (checked !== null) {
					return checked;
				}
				applyRecordTo(replayEntries, record);
				replaySeq = record.seq;
			}
		}
		const built = { contractVersion: REGISTRY_CONTRACT_VERSION, scope: scopeCopy, seq: replaySeq, entries: [...replayEntries.values()] };
		const snapshotText = await readText(snapshotPath);
		if (snapshotText === null) {
			await fsPort.writeFile(snapshotPath, canonicalJSON(built));
			commit(replayEntries, replaySeq);
			return { ok: true, seq: replaySeq, entries: replayEntries.size, recovered: disclosureFor("D_SNAPSHOT_REBUILT", { detail: "the snapshot was absent; rebuilt from journal replay" }) };
		}
		let parsed = null;
		try {
			parsed = JSON.parse(snapshotText);
		} catch (err) {
			return refused0("E_SNAPSHOT_MISMATCH", { detail: "the snapshot is not valid JSON" });
		}
		if (parsed === null || typeof parsed !== "object" || typeof parsed.seq !== "number" || !Array.isArray(parsed.entries)) {
			return refused0("E_SNAPSHOT_MISMATCH", { detail: "the snapshot is structurally invalid" });
		}
		if (parsed.seq > replaySeq) {
			return refused0("E_JOURNAL_TORN", { detail: "the snapshot records sequence " + parsed.seq + " but the journal holds " + replaySeq + " records; journal lines are missing" });
		}
		if (parsed.seq < replaySeq) {
			await fsPort.writeFile(snapshotPath, canonicalJSON(built));
			commit(replayEntries, replaySeq);
			return { ok: true, seq: replaySeq, entries: replayEntries.size, recovered: disclosureFor("D_SNAPSHOT_REBUILT", { detail: "the snapshot was stale at sequence " + parsed.seq + "; rebuilt from journal replay" }) };
		}
		if (canonicalJSON(parsed) !== canonicalJSON(built)) {
			return refused0("E_SNAPSHOT_MISMATCH", { detail: "journal replay and the snapshot disagree at sequence " + replaySeq });
		}
		commit(replayEntries, replaySeq);
		return { ok: true, seq: replaySeq, entries: replayEntries.size, recovered: null };
	}

	async function load() {
		if (loaded) {
			return { ok: true, seq: seq, entries: entries.size, recovered: null };
		}
		return loadImpl();
	}

	function findEntry(entryId) {
		if (typeof entryId !== "string" || entryId === "") {
			return null;
		}
		const entry = entries.get(entryId);
		return entry === undefined ? null : entry;
	}

	async function discover(discovery) {
		const gate = requireLoaded();
		if (gate !== null) {
			return { ok: false, refusal: gate };
		}
		if (discovery === null || typeof discovery !== "object" || Array.isArray(discovery)) {
			return refused("E_DISCOVERY_MALFORMED", { detail: "discovery must be an object" });
		}
		if (!isSourceKind(discovery.sourceKind)) {
			return refused("E_DISCOVERY_MALFORMED", { detail: "discovery.sourceKind must be one of the nine frozen source kinds; found: " + showValue(discovery.sourceKind) });
		}
		if (discovery.artifactKind !== undefined && !isArtifactKind(discovery.artifactKind)) {
			return refused("E_DISCOVERY_MALFORMED", { detail: "discovery.artifactKind must be a frozen artifact kind; found: " + showValue(discovery.artifactKind) });
		}
		if (discovery.contentHash !== undefined && (typeof discovery.contentHash !== "string" || discovery.contentHash === "")) {
			return refused("E_DISCOVERY_MALFORMED", { detail: "discovery.contentHash must be a non-empty string when present" });
		}
		const contentHash = typeof discovery.contentHash === "string" && discovery.contentHash !== "" ? discovery.contentHash : sha256Hex(canonicalJSON(discovery));
		for (const existing of entries.values()) {
			if (existing.contentHash === contentHash) {
				return { ok: true, entryId: existing.entryId, state: existing.state, disclosure: disclosureFor("D_DISCOVER_DUPLICATE", { detail: "content hash already recorded as entry " + existing.entryId }) };
			}
		}
		const version = typeof discovery.version === "string" && discovery.version !== "" ? discovery.version : null;
		const entryId = "e-" + sha256Hex(canonicalJSON({ contentHash: contentHash, version: version }));
		const toState = INITIAL_STATES.discover;
		const record = makeRecord("discover", entryId, null, toState, { discovery: sanitize(discovery), contentHash: contentHash });
		applyRecord(record);
		await persist(record);
		return { ok: true, entryId: entryId, state: toState, disclosure: null };
	}

	async function register(importedEntry) {
		const gate = requireLoaded();
		if (gate !== null) {
			return { ok: false, refusal: gate };
		}
		const violation = importViolation(importedEntry);
		if (violation !== null) {
			return { ok: false, refusal: violation };
		}
		let entry = null;
		if (typeof importedEntry.entryId === "string" && importedEntry.entryId !== "") {
			entry = findEntry(importedEntry.entryId);
			if (entry === null) {
				return refused("E_ENTRY_UNKNOWN", { entryId: importedEntry.entryId, detail: "register: the referenced discovered entry does not exist" });
			}
		} else {
			for (const candidate of entries.values()) {
				if (candidate.contentHash === importedEntry.digest && candidate.state === "discovered") {
					entry = candidate;
					break;
				}
			}
			if (entry === null) {
				let existing = null;
				for (const candidate of entries.values()) {
					if (candidate.contentHash === importedEntry.digest) {
						existing = candidate;
						break;
					}
				}
				return refused("E_REGISTER_REQUIRES_DISCOVERED", { detail: existing === null ? "no discovered entry with content hash " + importedEntry.digest : "entry " + existing.entryId + " with content hash " + importedEntry.digest + " is in state " + existing.state });
			}
		}
		if (entry.contentHash !== importedEntry.digest) {
			return refused("E_REGISTER_DIGEST_MISMATCH", { entryId: entry.entryId, state: entry.state, detail: "the discovered content hash " + entry.contentHash + " does not match the imported digest " + importedEntry.digest });
		}
		const machineResult = applyTransition(entry.state, "register", importedEntry);
		if (!machineResult.ok) {
			return refused(machineResult.refusal.code, { entryId: entry.entryId, state: entry.state, detail: machineResult.refusal.detail });
		}
		const record = makeRecord("register", entry.entryId, entry.state, machineResult.nextState, { imported: sanitize(importedEntry) });
		applyRecord(record);
		await persist(record);
		return { ok: true, entryId: entry.entryId, state: machineResult.nextState, disclosure: null };
	}

	async function verify(entryId, receipt) {
		const gate = requireLoaded();
		if (gate !== null) {
			return { ok: false, refusal: gate };
		}
		const entry = findEntry(entryId);
		if (entry === null) {
			return refused("E_ENTRY_UNKNOWN", { entryId: typeof entryId === "string" ? entryId : null, detail: "verify: unknown entry" });
		}
		const machineResult = applyTransition(entry.state, "verify", receipt);
		if (!machineResult.ok) {
			return refused(machineResult.refusal.code, { entryId: entry.entryId, state: entry.state, detail: machineResult.refusal.detail });
		}
		const record = makeRecord("verify", entry.entryId, entry.state, machineResult.nextState, { receipt: sanitize(receipt) });
		applyRecord(record);
		await persist(record);
		return { ok: true, entryId: entry.entryId, state: machineResult.nextState, disclosure: machineResult.disclosure === undefined ? null : machineResult.disclosure };
	}

	async function approve(entryId, decision) {
		const gate = requireLoaded();
		if (gate !== null) {
			return { ok: false, refusal: gate };
		}
		const entry = findEntry(entryId);
		if (entry === null) {
			return refused("E_ENTRY_UNKNOWN", { entryId: typeof entryId === "string" ? entryId : null, detail: "approve: unknown entry" });
		}
		if (decision === null || typeof decision !== "object" || Array.isArray(decision)) {
			return refused("E_APPROVAL_MALFORMED", { entryId: entry.entryId, state: entry.state, detail: "the approval decision must be an object" });
		}
		if (typeof decision.approver !== "string" || decision.approver === "") {
			return refused("E_APPROVAL_MALFORMED", { entryId: entry.entryId, state: entry.state, detail: "decision.approver must be a non-empty string" });
		}
		if (!Array.isArray(decision.acknowledgedPermissions)) {
			return refused("E_APPROVAL_MALFORMED", { entryId: entry.entryId, state: entry.state, detail: "decision.acknowledgedPermissions must be an array" });
		}
		const declared = entry.imported === null ? [] : entry.imported.permissions;
		const acknowledged = decision.acknowledgedPermissions;
		const missing = declared.filter(function (p) { return !acknowledged.includes(p); }).sort();
		const extra = acknowledged.filter(function (p) { return !declared.includes(p); }).sort();
		if (missing.length > 0 || extra.length > 0) {
			return refused("E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH", { entryId: entry.entryId, state: entry.state, detail: "unacknowledged declared permissions: [" + missing.join(", ") + "]; acknowledged undeclared permissions: [" + extra.join(", ") + "]" });
		}
		const machineResult = applyTransition(entry.state, "approve", decision);
		if (!machineResult.ok) {
			return refused(machineResult.refusal.code, { entryId: entry.entryId, state: entry.state, detail: machineResult.refusal.detail });
		}
		const record = makeRecord("approve", entry.entryId, entry.state, machineResult.nextState, { decision: null });
		record.payload.decision = { approver: decision.approver, acknowledgedPermissions: [...acknowledged].sort(), at: record.at, scope: scopeCopy };
		applyRecord(record);
		await persist(record);
		return { ok: true, entryId: entry.entryId, state: machineResult.nextState, disclosure: null };
	}

	async function enable(entryId) {
		const gate = requireLoaded();
		if (gate !== null) {
			return { ok: false, refusal: gate };
		}
		const entry = findEntry(entryId);
		if (entry === null) {
			return refused("E_ENTRY_UNKNOWN", { entryId: typeof entryId === "string" ? entryId : null, detail: "enable: unknown entry" });
		}
		const machineResult = applyTransition(entry.state, "enable", {});
		if (!machineResult.ok) {
			return refused(machineResult.refusal.code, { entryId: entry.entryId, state: entry.state, detail: machineResult.refusal.detail });
		}
		const record = makeRecord("enable", entry.entryId, entry.state, machineResult.nextState, {});
		applyRecord(record);
		await persist(record);
		return { ok: true, entryId: entry.entryId, state: machineResult.nextState, disclosure: null };
	}

	async function disable(entryId, reason) {
		const gate = requireLoaded();
		if (gate !== null) {
			return { ok: false, refusal: gate };
		}
		if (reason !== undefined && (typeof reason !== "string" || reason === "")) {
			return refused("E_ARGUMENT_MALFORMED", { detail: "the disable reason must be a non-empty string when present" });
		}
		const entry = findEntry(entryId);
		if (entry === null) {
			return refused("E_ENTRY_UNKNOWN", { entryId: typeof entryId === "string" ? entryId : null, detail: "disable: unknown entry" });
		}
		const machineResult = applyTransition(entry.state, "disable", {});
		if (!machineResult.ok) {
			return refused(machineResult.refusal.code, { entryId: entry.entryId, state: entry.state, detail: machineResult.refusal.detail });
		}
		const record = makeRecord("disable", entry.entryId, entry.state, machineResult.nextState, { cause: "disabled-by-operator", reason: reason === undefined ? null : reason });
		applyRecord(record);
		await persist(record);
		return { ok: true, entryId: entry.entryId, state: machineResult.nextState, disclosure: null };
	}

	/* The runtime-availability port (CR-006 ruling 1). Not one of    */
	/* the eleven stable operations: it is the reserved hook the      */
	/* runtime authority drives in later waves. Journaled like every  */
	/* mutating operation and routed through the pure machine.        */

	async function projectAvailability(entryId, facts) {
		const gate = requireLoaded();
		if (gate !== null) {
			return { ok: false, refusal: gate };
		}
		if (facts === null || typeof facts !== "object" || typeof facts.platformMatch !== "boolean" || typeof facts.dependenciesPresent !== "boolean") {
			return refused("E_PROJECTION_MALFORMED", { detail: "availability facts must be { platformMatch: boolean, dependenciesPresent: boolean }" });
		}
		const entry = findEntry(entryId);
		if (entry === null) {
			return refused("E_ENTRY_UNKNOWN", { entryId: typeof entryId === "string" ? entryId : null, detail: "projectAvailability: unknown entry" });
		}
		const machineResult = applyTransition(entry.state, "project", { platformMatch: facts.platformMatch, dependenciesPresent: facts.dependenciesPresent, cause: entry.unavailableCause });
		if (!machineResult.ok) {
			return refused(machineResult.refusal.code, { entryId: entry.entryId, state: entry.state, detail: machineResult.refusal.detail });
		}
		if (machineResult.disclosure !== undefined && machineResult.disclosure !== null) {
			return { ok: true, entryId: entry.entryId, state: entry.state, disclosure: machineResult.disclosure };
		}
		const record = makeRecord("project", entry.entryId, entry.state, machineResult.nextState, {
			facts: { platformMatch: facts.platformMatch, dependenciesPresent: facts.dependenciesPresent },
			cause: machineResult.cause === undefined ? null : machineResult.cause
		});
		applyRecord(record);
		await persist(record);
		return { ok: true, entryId: entry.entryId, state: machineResult.nextState, disclosure: null };
	}

	async function remove(entryId, reason) {
		const gate = requireLoaded();
		if (gate !== null) {
			return { ok: false, refusal: gate };
		}
		if (reason !== undefined && (typeof reason !== "string" || reason === "")) {
			return refused("E_ARGUMENT_MALFORMED", { detail: "the remove reason must be a non-empty string when present" });
		}
		const entry = findEntry(entryId);
		if (entry === null) {
			return refused("E_ENTRY_UNKNOWN", { entryId: typeof entryId === "string" ? entryId : null, detail: "remove: unknown entry" });
		}
		const machineResult = applyTransition(entry.state, "remove", {});
		if (!machineResult.ok) {
			return refused(machineResult.refusal.code, { entryId: entry.entryId, state: entry.state, detail: machineResult.refusal.detail });
		}
		const record = makeRecord("remove", entry.entryId, entry.state, machineResult.nextState, { reason: reason === undefined ? null : reason });
		applyRecord(record);
		await persist(record);
		return { ok: true, entryId: entry.entryId, state: machineResult.nextState, disclosure: null };
	}

	async function update(entryId, newEntry) {
		const gate = requireLoaded();
		if (gate !== null) {
			return { ok: false, refusal: gate };
		}
		const entry = findEntry(entryId);
		if (entry === null) {
			return refused("E_ENTRY_UNKNOWN", { entryId: typeof entryId === "string" ? entryId : null, detail: "update: unknown entry" });
		}
		if (entry.state === "revoked") {
			return refused("E_REVOKED_TERMINAL", { entryId: entry.entryId, state: entry.state });
		}
		const violation = importViolation(newEntry);
		if (violation !== null) {
			return { ok: false, refusal: violation };
		}
		if (entry.imported === null) {
			return refused("E_UPDATE_REQUIRES_IMPORTED", { entryId: entry.entryId, state: entry.state, detail: "version drift is defined over imported data" });
		}
		if (newEntry.version === entry.imported.version) {
			if (newEntry.digest === entry.imported.digest) {
				return { ok: true, entryId: entry.entryId, predecessor: entry.lineage.predecessor, state: entry.state, disclosure: disclosureFor("D_UPDATE_IDENTICAL", { detail: "the same version and digest; nothing to update" }) };
			}
			return refused("E_UPDATE_VERSION_DRIFT", { entryId: entry.entryId, state: entry.state, detail: "version " + newEntry.version + " is already recorded with digest " + entry.imported.digest + "; refusing the different digest " + newEntry.digest });
		}
		const toState = INITIAL_STATES.update;
		const newId = "e-" + sha256Hex(canonicalJSON({ contentHash: newEntry.digest, version: newEntry.version }));
		if (entries.has(newId)) {
			return { ok: true, entryId: newId, predecessor: entry.entryId, state: toState, disclosure: disclosureFor("D_UPDATE_IDENTICAL", { detail: "the lineage landing already exists as entry " + newId }) };
		}
		const record = makeRecord("update", newId, null, toState, { imported: sanitize(newEntry), predecessor: entry.entryId, contentHash: newEntry.digest });
		applyRecord(record);
		await persist(record);
		return { ok: true, entryId: newId, predecessor: entry.entryId, state: toState, disclosure: null };
	}

	async function inspect(entryId) {
		const gate = requireLoaded();
		if (gate !== null) {
			return { ok: false, refusal: gate };
		}
		const entry = findEntry(entryId);
		if (entry === null) {
			return refused("E_ENTRY_UNKNOWN", { entryId: typeof entryId === "string" ? entryId : null, detail: "inspect: unknown entry" });
		}
		let successor = null;
		for (const candidate of entries.values()) {
			if (candidate.lineage.predecessor === entry.entryId) {
				successor = candidate.entryId;
				break;
			}
		}
		const view = JSON.parse(canonicalJSON(entry));
		view.successor = successor;
		return { ok: true, entry: view };
	}

	function fieldDiff(a, b) {
		return { a: a, b: b, differs: a !== b };
	}

	function setDiff(a, b) {
		const inB = [];
		for (const item of b) {
			inB.push(item);
		}
		const inA = [];
		for (const item of a) {
			inA.push(item);
		}
		return {
			onlyInA: a.filter(function (x) { return !inB.includes(x); }).sort(),
			onlyInB: b.filter(function (x) { return !inA.includes(x); }).sort()
		};
	}

	async function compare(entryA, entryB) {
		const gate = requireLoaded();
		if (gate !== null) {
			return { ok: false, refusal: gate };
		}
		const a = findEntry(entryA);
		if (a === null) {
			return refused("E_ENTRY_UNKNOWN", { entryId: typeof entryA === "string" ? entryA : null, detail: "compare: unknown entry A" });
		}
		const b = findEntry(entryB);
		if (b === null) {
			return refused("E_ENTRY_UNKNOWN", { entryId: typeof entryB === "string" ? entryB : null, detail: "compare: unknown entry B" });
		}
		if (a.imported === null) {
			return refused("E_COMPARE_REQUIRES_IMPORTED", { entryId: a.entryId, state: a.state, detail: "compare: entry A has no imported data" });
		}
		if (b.imported === null) {
			return refused("E_COMPARE_REQUIRES_IMPORTED", { entryId: b.entryId, state: b.state, detail: "compare: entry B has no imported data" });
		}
		const ia = a.imported;
		const ib = b.imported;
		const permissions = setDiff(ia.permissions, ib.permissions);
		const endpoints = setDiff(ia.endpoints, ib.endpoints);
		const platforms = setDiff(ia.platforms, ib.platforms);
		const version = fieldDiff(ia.version, ib.version);
		const digest = fieldDiff(ia.digest, ib.digest);
		const license = fieldDiff(ia.license, ib.license);
		const differs = version.differs || digest.differs || license.differs || permissions.onlyInA.length > 0 || permissions.onlyInB.length > 0 || endpoints.onlyInA.length > 0 || endpoints.onlyInB.length > 0 || platforms.onlyInA.length > 0 || platforms.onlyInB.length > 0;
		return { ok: true, diff: { entryA: a.entryId, entryB: b.entryId, version: version, digest: digest, license: license, permissions: permissions, endpoints: endpoints, platforms: platforms, differs: differs } };
	}

	function summaryOf(entry) {
		const imported = entry.imported;
		const discovery = entry.discovery;
		return {
			entryId: entry.entryId,
			state: entry.state,
			contentHash: entry.contentHash,
			version: imported !== null ? imported.version : (discovery !== null && typeof discovery.version === "string" ? discovery.version : null),
			artifactKind: imported !== null ? imported.artifactKind : (discovery !== null && discovery.artifactKind !== undefined ? discovery.artifactKind : null),
			platforms: imported !== null ? imported.platforms : null
		};
	}

	async function query(predicate) {
		const gate = requireLoaded();
		if (gate !== null) {
			return { ok: false, refusal: gate };
		}
		if (predicate === null || typeof predicate !== "object" || Array.isArray(predicate)) {
			return refused("E_QUERY_MALFORMED", { detail: "the query predicate must be an object" });
		}
		const knownFields = ["state", "artifactKind", "platform", "permissionTier"];
		for (const key of Object.keys(predicate)) {
			if (!knownFields.includes(key)) {
				return refused("E_QUERY_MALFORMED", { detail: "unknown predicate field: " + key });
			}
		}
		if (predicate.state !== undefined && !isRegistryState(predicate.state)) {
			return refused("E_QUERY_MALFORMED", { detail: "predicate.state must be a frozen lifecycle state; found: " + showValue(predicate.state) });
		}
		if (predicate.artifactKind !== undefined && !isArtifactKind(predicate.artifactKind)) {
			return refused("E_QUERY_MALFORMED", { detail: "predicate.artifactKind must be a frozen artifact kind; found: " + showValue(predicate.artifactKind) });
		}
		if (predicate.platform !== undefined && (typeof predicate.platform !== "string" || !PLATFORMS.includes(predicate.platform))) {
			return refused("E_QUERY_MALFORMED", { detail: "predicate.platform must be a frozen platform; found: " + showValue(predicate.platform) });
		}
		if (predicate.permissionTier !== undefined && (typeof predicate.permissionTier !== "string" || !RISK_TIERS.includes(predicate.permissionTier))) {
			return refused("E_QUERY_MALFORMED", { detail: "predicate.permissionTier must be a frozen risk tier; found: " + showValue(predicate.permissionTier) });
		}
		const matched = [];
		for (const entry of entries.values()) {
			if (predicate.state !== undefined && entry.state !== predicate.state) {
				continue;
			}
			if (predicate.artifactKind !== undefined && (entry.imported === null || entry.imported.artifactKind !== predicate.artifactKind)) {
				continue;
			}
			if (predicate.platform !== undefined && (entry.imported === null || !entry.imported.platforms.includes(predicate.platform))) {
				continue;
			}
			if (predicate.permissionTier !== undefined) {
				if (entry.imported === null) {
					continue;
				}
				let tierMatch = false;
				for (const permission of entry.imported.permissions) {
					if (permissionTier(permission) === predicate.permissionTier) {
						tierMatch = true;
						break;
					}
				}
				if (!tierMatch) {
					continue;
				}
			}
			matched.push(summaryOf(entry));
		}
		matched.sort(function (x, y) {
			return x.entryId < y.entryId ? -1 : (x.entryId > y.entryId ? 1 : 0);
		});
		return { ok: true, count: matched.length, entries: matched };
	}

	return {
		load: load,
		discover: discover,
		inspect: inspect,
		compare: compare,
		verify: verify,
		approve: approve,
		register: register,
		enable: enable,
		disable: disable,
		update: update,
		remove: remove,
		query: query,
		projectAvailability: projectAvailability
	};
}