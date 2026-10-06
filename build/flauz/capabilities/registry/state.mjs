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
/* The pure registry state machine: no fs, no clock, deterministic.   */
/* Every vocabulary below is a frozen copy of the ZC-006/007          */
/* contracts; the test battery cross-pins both directions.            */
/* ------------------------------------------------------------------ */

import { createHash } from "node:crypto";

export const REGISTRY_CONTRACT_VERSION = "cr-006.1";

/* The eight frozen lifecycle states (CR-006 ruling 1).               */

export const REGISTRY_STATES = Object.freeze([
	"discovered",
	"imported",
	"verified",
	"approved",
	"enabled",
	"available",
	"unavailable",
	"revoked"
]);

/* The eleven ruled operations (CR-006 ruling 2) plus the            */
/* machine-level transition vocabulary. Registry-layer operations    */
/* (discover, inspect, compare, update, query) are not lifecycle     */
/* transitions of an existing entry.                                  */

export const REGISTRY_OPS = Object.freeze([
	"discover",
	"inspect",
	"compare",
	"verify",
	"approve",
	"register",
	"enable",
	"disable",
	"update",
	"remove",
	"query"
]);

export const TRANSITION_OPS = Object.freeze([
	"register",
	"verify",
	"approve",
	"enable",
	"disable",
	"remove",
	"project"
]);

/* Entry creation laws: which operations may create an entry and at  */
/* which state. discover creates at discovered; update creates the   */
/* fresh lineage entry at imported. Everything else operates on an   */
/* existing entry.                                                    */

export const INITIAL_STATES = Object.freeze({
	discover: "discovered",
	update: "imported"
});

/* The granted edges, and ONLY the granted edges. The runtime never  */
/* invents a transition the machine refuses.                          */

export const TRANSITIONS = Object.freeze({
	discovered: Object.freeze({ register: Object.freeze(["imported"]), remove: Object.freeze(["revoked"]) }),
	imported: Object.freeze({ verify: Object.freeze(["verified", "unavailable"]), remove: Object.freeze(["revoked"]) }),
	verified: Object.freeze({ approve: Object.freeze(["approved"]), remove: Object.freeze(["revoked"]) }),
	approved: Object.freeze({ enable: Object.freeze(["enabled"]), remove: Object.freeze(["revoked"]) }),
	enabled: Object.freeze({ project: Object.freeze(["available", "unavailable"]), disable: Object.freeze(["unavailable"]), remove: Object.freeze(["revoked"]) }),
	available: Object.freeze({ project: Object.freeze(["available", "unavailable"]), disable: Object.freeze(["unavailable"]), remove: Object.freeze(["revoked"]) }),
	unavailable: Object.freeze({ project: Object.freeze(["available", "unavailable"]), remove: Object.freeze(["revoked"]) }),
	revoked: Object.freeze({})
});

/* The unavailability causes. Runtime-projected causes may recover   */
/* without re-approval (ruling 1); the other two recover only via    */
/* the new-version lineage (ruling 3).                                */

export const UNAVAILABLE_CAUSES = Object.freeze([
	"platform-mismatch",
	"dependency-missing",
	"verification-failed",
	"disabled-by-operator"
]);

export const RUNTIME_PROJECTED_CAUSES = Object.freeze([
	"platform-mismatch",
	"dependency-missing"
]);

/* ------------------------------------------------------------------ */
/* The frozen refusal table. Every refusal is a typed record:         */
/* code + the exact violated law + entryId + state. Never a string    */
/* throw, never a silent skip. Cross-pinned by tests.                 */
/* ------------------------------------------------------------------ */

export const REFUSALS = Object.freeze({
	E_UNKNOWN_STATE: Object.freeze({ code: "E_UNKNOWN_STATE", law: "the registry lifecycle vocabulary is frozen; an unknown state is a typed refusal (CR-006 2a)." }),
	E_UNKNOWN_OP: Object.freeze({ code: "E_UNKNOWN_OP", law: "the registry operation surface is frozen; an unknown operation is a typed refusal (CR-006 2b)." }),
	E_OP_NOT_A_TRANSITION: Object.freeze({ code: "E_OP_NOT_A_TRANSITION", law: "discover, inspect, compare, update, and query are registry-layer operations, not lifecycle transitions of an existing entry (CR-006 2b)." }),
	E_ILLEGAL_TRANSITION: Object.freeze({ code: "E_ILLEGAL_TRANSITION", law: "the pure machine refuses every transition not granted by the lifecycle tables; the runtime never invents a transition the machine refuses (CR-006 2c)." }),
	E_REVOKED_TERMINAL: Object.freeze({ code: "E_REVOKED_TERMINAL", law: "revoked is terminal: any use-attempt of a revoked entry is an explicit typed failure (CR-006 2a)." }),
	E_REGISTER_REQUIRES_DISCOVERED: Object.freeze({ code: "E_REGISTER_REQUIRES_DISCOVERED", law: "register lands the completed ZC-007 import chain on a discovered entry only (CR-006 2b)." }),
	E_REGISTER_DIGEST_MISMATCH: Object.freeze({ code: "E_REGISTER_DIGEST_MISMATCH", law: "the imported digest must match the discovered content hash; a contradicting import fails closed (CR-006 law 4)." }),
	E_VERIFY_REQUIRES_IMPORTED: Object.freeze({ code: "E_VERIFY_REQUIRES_IMPORTED", law: "a verification receipt lands only on an imported entry; entries always enter unverified (CR-006 2a, ZC-007 law)." }),
	E_RECEIPT_MALFORMED: Object.freeze({ code: "E_RECEIPT_MALFORMED", law: "a receipt that derives no frozen verification status, or carries empty checks, fails closed as a typed refusal (CR-006 2a, ZC-006 vocabulary)." }),
	E_APPROVE_REQUIRES_VERIFIED: Object.freeze({ code: "E_APPROVE_REQUIRES_VERIFIED", law: "approving anything not in verified is a typed refusal (CR-006 2a)." }),
	E_APPROVAL_MALFORMED: Object.freeze({ code: "E_APPROVAL_MALFORMED", law: "an approval decision must name an approver and acknowledge the declared permissions (CR-006 2a decision shape)." }),
	E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH: Object.freeze({ code: "E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH", law: "the approval decision must acknowledge every declared permission of the entry exactly (CR-006 2a, declared-permissions-acknowledged)." }),
	E_ENABLE_REQUIRES_APPROVED: Object.freeze({ code: "E_ENABLE_REQUIRES_APPROVED", law: "enabling anything not approved is a typed refusal; the discover-to-install-to-auto-trust path is forbidden and fails closed (CR-006 2a)." }),
	E_DISABLE_REQUIRES_ENABLED: Object.freeze({ code: "E_DISABLE_REQUIRES_ENABLED", law: "disable applies only to an operator-enabled entry, in state enabled or available (CR-006 2a)." }),
	E_PROJECT_REQUIRES_ENABLED: Object.freeze({ code: "E_PROJECT_REQUIRES_ENABLED", law: "availability is the runtime projection of an enabled entry; entries not yet enabled have no availability view (CR-006 ruling 1)." }),
	E_PROJECTION_MALFORMED: Object.freeze({ code: "E_PROJECTION_MALFORMED", law: "availability facts must be platformMatch and dependenciesPresent booleans (CR-006 ruling 1)." }),
	E_RECOVERY_FORBIDDEN: Object.freeze({ code: "E_RECOVERY_FORBIDDEN", law: "runtime recovery is granted only for runtime-projected unavailability; verification-failed and disabled-by-operator recover through the new-version lineage only (CR-006 rulings 1 and 3)." }),
	E_IMPORT_MALFORMED_ENTRY: Object.freeze({ code: "E_IMPORT_MALFORMED_ENTRY", law: "the ZC-007 import guard fails closed on a malformed imported entry, naming the violation (CR-006 2b register)." }),
	E_IMPORT_MISSING_LICENSE: Object.freeze({ code: "E_IMPORT_MISSING_LICENSE", law: "canImport fails closed on a missing license, naming the violation (ZC-007 canImport; CR-006 2b)." }),
	E_IMPORT_MISSING_DIGEST: Object.freeze({ code: "E_IMPORT_MISSING_DIGEST", law: "canImport fails closed on a missing digest, naming the violation (ZC-007 canImport; CR-006 2b)." }),
	E_IMPORT_PERMISSION_OUT_OF_TABLE: Object.freeze({ code: "E_IMPORT_PERMISSION_OUT_OF_TABLE", law: "canImport fails closed on a permission outside the frozen capability permission table, naming the violation (ZC-007 canImport; CR-006 2b)." }),
	E_ENTRY_ENTERS_UNVERIFIED: Object.freeze({ code: "E_ENTRY_ENTERS_UNVERIFIED", law: "entries always enter the registry unverified; an imported entry claiming a verification status fails closed (CR-006 2a, ZC-007 law)." }),
	E_UPDATE_REQUIRES_IMPORTED: Object.freeze({ code: "E_UPDATE_REQUIRES_IMPORTED", law: "version drift is defined over imported data; update requires an imported entry (CR-006 2b update)." }),
	E_UPDATE_VERSION_DRIFT: Object.freeze({ code: "E_UPDATE_VERSION_DRIFT", law: "the same version with a different hash refuses; a new version creates a fresh entry lineage, never an in-place mutation (CR-006 2b update, the drift law)." }),
	E_ENTRY_UNKNOWN: Object.freeze({ code: "E_ENTRY_UNKNOWN", law: "every operation on an unknown entry id is a typed refusal; there are no silent misses (CR-006 law 4)." }),
	E_NOT_LOADED: Object.freeze({ code: "E_NOT_LOADED", law: "the registry must complete load() before any operation; an unloaded registry fails closed (CR-006 2c)." }),
	E_DISCOVERY_MALFORMED: Object.freeze({ code: "E_DISCOVERY_MALFORMED", law: "a discovery that is not a frozen ZC-007 shape refuses with the violation named (CR-006 2b discover)." }),
	E_QUERY_MALFORMED: Object.freeze({ code: "E_QUERY_MALFORMED", law: "a query predicate with an unknown field or a non-frozen value refuses with the violation named (CR-006 2b query)." }),
	E_COMPARE_REQUIRES_IMPORTED: Object.freeze({ code: "E_COMPARE_REQUIRES_IMPORTED", law: "compare is defined over imported entries; a pre-import entry refuses with the violation named (CR-006 2b compare)." }),
	E_ARGUMENT_MALFORMED: Object.freeze({ code: "E_ARGUMENT_MALFORMED", law: "an operation argument failed closed validation; the violation is named in the detail (CR-006 law 4)." }),
	E_JOURNAL_TORN: Object.freeze({ code: "E_JOURNAL_TORN", law: "a torn or missing journal line fails closed with the typed recovery error; never a silent skip (CR-006 2c)." }),
	E_JOURNAL_UNLAWFUL: Object.freeze({ code: "E_JOURNAL_UNLAWFUL", law: "a journal record that the pure machine does not grant fails closed as tampering or corruption (CR-006 2c)." }),
	E_SNAPSHOT_MISMATCH: Object.freeze({ code: "E_SNAPSHOT_MISMATCH", law: "journal replay and the snapshot cross-check must rebuild the identical state; divergence fails closed (CR-006 2c)." })
});

/* Disclosures: honest non-error, non-advancing outcomes.            */

export const DISCLOSURES = Object.freeze({
	D_DISCOVER_DUPLICATE: Object.freeze({ code: "D_DISCOVER_DUPLICATE", note: "discover is idempotent on content hash: one entry; a repeat observation is a typed disclosure, not an error and not a duplicate (CR-006 3)." }),
	D_VERIFICATION_PARTIAL: Object.freeze({ code: "D_VERIFICATION_PARTIAL", note: "verified-partial is a non-advancing disclosure: the receipt is recorded and the state is unchanged (CR-006 2a)." }),
	D_VERIFICATION_UNCHANGED: Object.freeze({ code: "D_VERIFICATION_UNCHANGED", note: "a receipt deriving unverified is recorded without advancement: the state is unchanged (CR-006 2a)." }),
	D_PROJECTION_UNCHANGED: Object.freeze({ code: "D_PROJECTION_UNCHANGED", note: "the runtime availability facts are unchanged: a non-mutating disclosure (CR-006 ruling 1)." }),
	D_UPDATE_IDENTICAL: Object.freeze({ code: "D_UPDATE_IDENTICAL", note: "the same version and digest is an idempotent disclosure: no fresh lineage, no mutation (CR-006 2b update)." }),
	D_SNAPSHOT_REBUILT: Object.freeze({ code: "D_SNAPSHOT_REBUILT", note: "the snapshot was absent or stale; it was rebuilt byte-identically from journal replay (CR-006 2c)." })
});

export function refusalFor(code, context) {
	const entry = REFUSALS[code];
	if (entry === undefined) {
		throw new TypeError("unknown refusal code: " + showValue(code));
	}
	const ctx = context === undefined || context === null ? {} : context;
	return Object.freeze({
		code: entry.code,
		law: entry.law,
		entryId: ctx.entryId === undefined ? null : ctx.entryId,
		state: ctx.state === undefined ? null : ctx.state,
		detail: ctx.detail === undefined ? null : ctx.detail
	});
}

export function disclosureFor(code, context) {
	const entry = DISCLOSURES[code];
	if (entry === undefined) {
		throw new TypeError("unknown disclosure code: " + showValue(code));
	}
	const ctx = context === undefined || context === null ? {} : context;
	return Object.freeze({
		code: entry.code,
		note: entry.note,
		detail: ctx.detail === undefined ? null : ctx.detail
	});
}

/* ------------------------------------------------------------------ */
/* Vocabulary cross-pins (CR-006 2d). THE DISK WINS: these frozen     */
/* copies are transcribed from the ZC-006/007 contract modules and    */
/* pinned bidirectionally by the test battery, which imports the      */
/* contract modules directly.                                          */
/*                                                                     */
/* DRAFTED, NOT DISK-PINNED: the permission-to-tier mapping below.    */
/* The paste supplied the permission ids and the risk tiers but not  */
/* the mapping; only query(permissionTier) consumes it. The id list   */
/* and the tier list are cross-pinned.                                 */
/* ------------------------------------------------------------------ */

export const ARTIFACT_KINDS = Object.freeze(["cli", "skill-instructions", "mcp-server", "commands"]);

export const PERMISSION_IDS = Object.freeze(["read-files", "execute-command", "network-access", "write-workspace"]);

export const RISK_TIERS = Object.freeze(["low", "moderate", "high"]);

export const PLATFORMS = Object.freeze(["darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64", "windows-x64"]);

export const VERIFICATION_STATUSES = Object.freeze(["unverified", "verified", "verified-partial", "verification-failed"]);

export const SOURCE_KINDS = Object.freeze([
	"printing-press",
	"printing-press-library",
	"composio",
	"mcp-catalog",
	"skill-catalog",
	"user-spec",
	"api-spec",
	"site-spec",
	"community-project"
]);

export const IMPORT_CHAIN = Object.freeze(["discovered", "fetched", "normalized", "registered"]);

export const PERMISSION_TABLE = Object.freeze({
	"read-files": "low",
	"execute-command": "high",
	"network-access": "high",
	"write-workspace": "moderate"
});

export function showValue(value) {
	if (typeof value === "string") {
		return '"' + value + '"';
	}
	if (value === undefined) {
		return "undefined";
	}
	if (value === null) {
		return "null";
	}
	return String(value);
}

export function isRegistryState(value) {
	return typeof value === "string" && REGISTRY_STATES.includes(value);
}

export function isArtifactKind(value) {
	return typeof value === "string" && ARTIFACT_KINDS.includes(value);
}

export function isVerificationStatus(value) {
	return typeof value === "string" && VERIFICATION_STATUSES.includes(value);
}

export function isSourceKind(value) {
	return typeof value === "string" && SOURCE_KINDS.includes(value);
}

export function isPermission(value) {
	return typeof value === "string" && PERMISSION_IDS.includes(value);
}

export function isPlatform(value) {
	return typeof value === "string" && PLATFORMS.includes(value);
}

export function isRiskTier(value) {
	return typeof value === "string" && RISK_TIERS.includes(value);
}

export function isUnavailableCause(value) {
	return typeof value === "string" && UNAVAILABLE_CAUSES.includes(value);
}

export function permissionTier(permission) {
	return Object.prototype.hasOwnProperty.call(PERMISSION_TABLE, permission) ? PERMISSION_TABLE[permission] : null;
}

/* The derived receipt status. The ZC-006 derivation (claim vs.      */
/* checks) lives in verification.ts; this minimal consumer validates  */
/* the claim against the frozen status vocabulary and fails closed    */
/* (null) on anything else.                                           */

export function verificationStatusFor(receipt) {
	if (receipt === null || typeof receipt !== "object") {
		return null;
	}
	return isVerificationStatus(receipt.verificationStatus) ? receipt.verificationStatus : null;
}

/* The ZC-007 canImport guard: fail closed, violation NAMED.          */

export function importViolation(importedEntry) {
	if (importedEntry === null || typeof importedEntry !== "object" || Array.isArray(importedEntry)) {
		return refusalFor("E_IMPORT_MALFORMED_ENTRY", { detail: "imported entry is not an object" });
	}
	if (importedEntry.license === undefined || importedEntry.license === null || importedEntry.license === "") {
		return refusalFor("E_IMPORT_MISSING_LICENSE", { detail: "license is missing" });
	}
	if (importedEntry.digest === undefined || importedEntry.digest === null || importedEntry.digest === "") {
		return refusalFor("E_IMPORT_MISSING_DIGEST", { detail: "digest is missing" });
	}
	if (importedEntry.version === undefined || importedEntry.version === null || importedEntry.version === "") {
		return refusalFor("E_IMPORT_MALFORMED_ENTRY", { detail: "version is missing" });
	}
	if (!isArtifactKind(importedEntry.artifactKind)) {
		return refusalFor("E_IMPORT_MALFORMED_ENTRY", { detail: "artifactKind must be a frozen artifact kind; found: " + showValue(importedEntry.artifactKind) });
	}
	if (!Array.isArray(importedEntry.permissions)) {
		return refusalFor("E_IMPORT_MALFORMED_ENTRY", { detail: "permissions must be an array" });
	}
	const seen = [];
	for (const permission of importedEntry.permissions) {
		if (!isPermission(permission)) {
			return refusalFor("E_IMPORT_PERMISSION_OUT_OF_TABLE", { detail: "permission is not in the frozen capability permission table: " + showValue(permission) });
		}
		if (seen.includes(permission)) {
			return refusalFor("E_IMPORT_MALFORMED_ENTRY", { detail: "duplicate permission: " + showValue(permission) });
		}
		seen.push(permission);
	}
	if (!Array.isArray(importedEntry.platforms)) {
		return refusalFor("E_IMPORT_MALFORMED_ENTRY", { detail: "platforms must be an array" });
	}
	for (const platform of importedEntry.platforms) {
		if (!isPlatform(platform)) {
			return refusalFor("E_IMPORT_MALFORMED_ENTRY", { detail: "platform must be a frozen platform; found: " + showValue(platform) });
		}
	}
	if (!Array.isArray(importedEntry.endpoints)) {
		return refusalFor("E_IMPORT_MALFORMED_ENTRY", { detail: "endpoints must be an array" });
	}
	for (const endpoint of importedEntry.endpoints) {
		if (typeof endpoint !== "string" || endpoint === "") {
			return refusalFor("E_IMPORT_MALFORMED_ENTRY", { detail: "endpoints must be non-empty strings" });
		}
	}
	if (importedEntry.provenance === null || typeof importedEntry.provenance !== "object" || Array.isArray(importedEntry.provenance)) {
		return refusalFor("E_IMPORT_MALFORMED_ENTRY", { detail: "provenance must be an object" });
	}
	if (importedEntry.verificationStatus !== undefined && importedEntry.verificationStatus !== "unverified") {
		return refusalFor("E_ENTRY_ENTERS_UNVERIFIED", { detail: "imported entry claims verification status " + showValue(importedEntry.verificationStatus) + "; entries always enter unverified" });
	}
	return null;
}

/* Fast boolean: is the op lawful from the state at all.              */

export function canTransition(state, op) {
	if (!isRegistryState(state)) {
		return false;
	}
	return Object.prototype.hasOwnProperty.call(TRANSITIONS[state], op);
}

function grant(state, op, nextState, extra) {
	const targets = TRANSITIONS[state][op];
	if (targets === undefined || !targets.includes(nextState)) {
		return { ok: false, refusal: refusalFor("E_ILLEGAL_TRANSITION", { state: state, detail: "the machine refuses " + op + " from " + state + " to " + nextState }) };
	}
	const result = { ok: true, nextState: nextState };
	if (extra !== undefined && extra !== null && typeof extra === "object") {
		for (const key of Object.keys(extra)) {
			result[key] = extra[key];
		}
	}
	return result;
}

/* The pure guarded reducer for an existing entry.                    */
/* Returns { ok: true, nextState, cause?, disclosure? } or            */
/* { ok: false, refusal } - never a throw, never a silent skip.       */

export function applyTransition(state, op, input) {
	if (!isRegistryState(state)) {
		return { ok: false, refusal: refusalFor("E_UNKNOWN_STATE", { state: state === undefined ? null : state, detail: "unknown lifecycle state: " + showValue(state) }) };
	}
	if (typeof op !== "string") {
		return { ok: false, refusal: refusalFor("E_UNKNOWN_OP", { state: state, detail: "op must be a string" }) };
	}
	if (state === "revoked") {
		return { ok: false, refusal: refusalFor("E_REVOKED_TERMINAL", { state: state }) };
	}
	if (REGISTRY_OPS.includes(op) && !TRANSITION_OPS.includes(op)) {
		return { ok: false, refusal: refusalFor("E_OP_NOT_A_TRANSITION", { state: state, detail: op + " is not a lifecycle transition of an existing entry" }) };
	}
	switch (op) {
		case "register": {
			if (state !== "discovered") {
				return { ok: false, refusal: refusalFor("E_REGISTER_REQUIRES_DISCOVERED", { state: state, detail: "register lands only on a discovered entry" }) };
			}
			const violation = importViolation(input);
			if (violation !== null) {
				return { ok: false, refusal: violation };
			}
			return grant(state, op, "imported");
		}
		case "verify": {
			if (state !== "imported") {
				return { ok: false, refusal: refusalFor("E_VERIFY_REQUIRES_IMPORTED", { state: state, detail: "verification receipts land only on an imported entry" }) };
			}
			if (input === null || typeof input !== "object") {
				return { ok: false, refusal: refusalFor("E_RECEIPT_MALFORMED", { state: state, detail: "receipt is not an object" }) };
			}
			if (input.checks !== undefined && !Array.isArray(input.checks)) {
				return { ok: false, refusal: refusalFor("E_RECEIPT_MALFORMED", { state: state, detail: "receipt.checks must be an array when present" }) };
			}
			if (Array.isArray(input.checks) && input.checks.length === 0) {
				return { ok: false, refusal: refusalFor("E_RECEIPT_MALFORMED", { state: state, detail: "receipt.checks must not be empty" }) };
			}
			const status = verificationStatusFor(input);
			if (status === null) {
				return { ok: false, refusal: refusalFor("E_RECEIPT_MALFORMED", { state: state, detail: "receipt.verificationStatus must be one of the frozen verification statuses" }) };
			}
			if (status === "verified") {
				return grant(state, op, "verified");
			}
			if (status === "verified-partial") {
				return { ok: true, nextState: state, disclosure: disclosureFor("D_VERIFICATION_PARTIAL", { detail: "receipt recorded; the entry state is unchanged" }) };
			}
			if (status === "verification-failed") {
				return grant(state, op, "unavailable", { cause: "verification-failed" });
			}
			return { ok: true, nextState: state, disclosure: disclosureFor("D_VERIFICATION_UNCHANGED", { detail: "receipt recorded without advancement; the entry state is unchanged" }) };
		}
		case "approve": {
			if (state !== "verified") {
				return { ok: false, refusal: refusalFor("E_APPROVE_REQUIRES_VERIFIED", { state: state, detail: "approving anything not in verified is refused" }) };
			}
			return grant(state, op, "approved");
		}
		case "enable": {
			if (state !== "approved") {
				return { ok: false, refusal: refusalFor("E_ENABLE_REQUIRES_APPROVED", { state: state, detail: "enabling anything not approved is refused" }) };
			}
			return grant(state, op, "enabled");
		}
		case "disable": {
			if (state !== "enabled" && state !== "available") {
				return { ok: false, refusal: refusalFor("E_DISABLE_REQUIRES_ENABLED", { state: state, detail: "disable applies only to an operator-enabled entry (enabled or available)" }) };
			}
			return grant(state, op, "unavailable", { cause: "disabled-by-operator" });
		}
		case "project": {
			if (input === null || typeof input !== "object" || typeof input.platformMatch !== "boolean" || typeof input.dependenciesPresent !== "boolean") {
				return { ok: false, refusal: refusalFor("E_PROJECTION_MALFORMED", { state: state, detail: "availability facts must be { platformMatch: boolean, dependenciesPresent: boolean }" }) };
			}
			if (state !== "enabled" && state !== "available" && state !== "unavailable") {
				return { ok: false, refusal: refusalFor("E_PROJECT_REQUIRES_ENABLED", { state: state, detail: "availability is the runtime projection of an enabled entry" }) };
			}
			const badCause = !input.platformMatch ? "platform-mismatch" : (input.dependenciesPresent ? null : "dependency-missing");
			if (badCause === null) {
				if (state === "available") {
					return { ok: true, nextState: state, disclosure: disclosureFor("D_PROJECTION_UNCHANGED", { detail: "runtime availability facts unchanged" }) };
				}
				if (state === "unavailable") {
					const entryCause = input.cause === undefined ? null : input.cause;
					if (entryCause === null || !RUNTIME_PROJECTED_CAUSES.includes(entryCause)) {
						return { ok: false, refusal: refusalFor("E_RECOVERY_FORBIDDEN", { state: state, detail: "runtime recovery is forbidden from unavailability cause " + showValue(entryCause) + "; that cause recovers through the new-version lineage only" }) };
					}
				}
				return grant(state, op, "available", { cause: null });
			}
			if (state === "unavailable" && input.cause === badCause) {
				return { ok: true, nextState: state, disclosure: disclosureFor("D_PROJECTION_UNCHANGED", { detail: "runtime availability facts unchanged" }) };
			}
			return grant(state, op, "unavailable", { cause: badCause });
		}
		case "remove": {
			return grant(state, op, "revoked");
		}
		default:
			return { ok: false, refusal: refusalFor("E_UNKNOWN_OP", { state: state, detail: "unknown transition op: " + showValue(op) }) };
	}
}

/* Deterministic canonical bytes and sha256. Hashing is              */
/* deterministic and allowed; it is not randomness.                   */

export function canonicalJSON(value) {
	if (value === null || typeof value !== "object") {
		const text = JSON.stringify(value);
		return text === undefined ? "null" : text;
	}
	if (Array.isArray(value)) {
		return "[" + value.map(function (item) { return canonicalJSON(item); }).join(",") + "]";
	}
	const keys = Object.keys(value).sort();
	const parts = [];
	for (const key of keys) {
		parts.push(JSON.stringify(key) + ":" + canonicalJSON(value[key]));
	}
	return "{" + parts.join(",") + "}";
}

export function sha256Hex(text) {
	return createHash("sha256").update(text, "utf8").digest("hex");
}