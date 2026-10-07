/* ------------------------------------------------------------------ */
/* Flauz Capability Exchange - CR-008 verification + permission gate  */
/* (B2, Phase C-R wave 3).                                            */
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
/* MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND              */
/* NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT        */
/* HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,       */
/* WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, */
/* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER      */
/* DEALINGS IN THE SOFTWARE.                                           */
/* ------------------------------------------------------------------ */
/* THE GATE IS A RUNTIME CONSUMER, NEVER A SECOND AUTHORITY.          */
/*                                                                     */
/* Laws this module lives by (CR-008):                                 */
/*                                                                     */
/* 1. The CR-006 registry IS the capability lifecycle authority       */
/*    (the eight states, the eleven operations, the JSONL journal).   */
/*    The gate owns NO lifecycle state, keeps NO shadow catalog,      */
/*    and writes NO second journal. Every lifecycle change is a       */
/*    registry operation call over the SAME root - one journal.       */
/* 2. Fail closed: no capability reaches `enabled` without verified   */
/*    status and an acknowledged permission decision.                 */
/* 3. Typed refusals name the violated law VERBATIM. Frozen refusal   */
/*    codes and laws are consumed from the registry's own frozen      */
/*    tables (state.mjs, re-exported through the stable B2            */
/*    interface) - never transcribed here. The ONE gate-owned code    */
/*    (E_HIGH_RISK_UNACKNOWLEDGED) and the ONE gate-owned warning     */
/*    code (W_ENABLE_VERIFICATION_PARTIAL) are declared below and     */
/*    are NEVER promoted into the frozen tables.                      */
/* 4. The gate's own records (<root>/.flauz/gate/records.jsonl) are   */
/*    DECISION EVIDENCE, never lifecycle state: receipts it           */
/*    submitted, permission decisions, durable operator warnings.     */
/* 5. Determinism: the clock is injected; canonical JSON via the      */
/*    registry's own serializer; no wall-clock or randomness          */
/*    primitives anywhere in this module.                             */
/* 6. Vocabulary sourcing: the verification status vocabulary and     */
/*    the frozen tables are imported from the registry; the           */
/*    permission risk tiers are transcribed from the frozen ZC-006    */
/*    catalog (packs/common/catalog.ts CATALOG_PERMISSION_TABLE,      */
/*    the CR-008 3c paste) and cross-pinned by the battery -          */
/*    deliberately NOT sourced from state.mjs PERMISSION_TABLE,       */
/*    which is self-marked DRAFTED, NOT DISK-PINNED.                  */
/*                                                                     */
/* Live-view semantics: the gate holds ONE registry instance loaded   */
/* at construction (CR-008 law 4.1), mirroring the registry's own     */
/* one-journal-many-instances semantics. The journal is the truth; a  */
/* restarted gate (loadGate) sees every record.                       */
/* ------------------------------------------------------------------ */

import {
	createRegistry,
	refusalFor,
	canonicalJSON,
	VERIFICATION_STATUSES
} from "../registry/registry.mjs";
import type {
	FsPort,
	RegistryScope,
	RegistryEntryView,
	VerificationReceiptInput
} from "../registry/registry.mjs";

/* ------------------------------------------------------------------ */
/* Gate-owned vocabulary (disclosed; never promoted into the frozen   */
/* tables).                                                            */
/* ------------------------------------------------------------------ */

export const GATE_CONTRACT_VERSION = "cr-008.1";

export const GATE_REFUSALS = Object.freeze({
	E_HIGH_RISK_UNACKNOWLEDGED: Object.freeze({
		code: "E_HIGH_RISK_UNACKNOWLEDGED",
		law: "a permission decision that acknowledges a high-risk permission must carry an explicit risk acknowledgement (riskAcknowledged: true); the high-risk tier is fixed by the frozen capability permission table (execute-command, network-access); a high-risk acknowledgement without it fails closed (CR-008 gate law 4.3; gate-owned vocabulary, never promoted into the frozen tables)."
	})
});

export const GATE_WARNINGS = Object.freeze({
	W_ENABLE_VERIFICATION_PARTIAL: Object.freeze({
		code: "W_ENABLE_VERIFICATION_PARTIAL",
		note: "an entry whose receipt history contains verified-partial receipts was enabled; the enable path stays legal per the machine, and the partial checks census is disclosed to the operator as a durable warning (CR-008 4.4; gate-owned vocabulary, never promoted into the frozen tables)."
	})
});

/* The permission risk tiers, transcribed from the frozen ZC-006     */
/* catalog (packs/common/catalog.ts CATALOG_PERMISSION_TABLE; the     */
/* CR-008 3c paste). Cross-pinned by the battery against the pasted   */
/* table and behaviorally against the registry's own                  */
/* query(permissionTier) view. NOT sourced from registry state.mjs    */
/* PERMISSION_TABLE (self-marked DRAFTED, NOT DISK-PINNED).           */

export const GATE_PERMISSION_RISK_TIERS: Readonly<Record<string, string>> = Object.freeze({
	"read-files": "low",
	"execute-command": "high",
	"network-access": "high",
	"write-workspace": "moderate"
});

export function permissionRiskTier(permission: string): string | null {
	return Object.prototype.hasOwnProperty.call(GATE_PERMISSION_RISK_TIERS, permission) ? GATE_PERMISSION_RISK_TIERS[permission] : null;
}

export function isHighRiskPermission(permission: string): boolean {
	return permissionRiskTier(permission) === "high";
}

/* ------------------------------------------------------------------ */
/* The public surface. Inputs are deliberately loose: the gate         */
/* validates every value and throws typed refusals; invalid values     */
/* must stay representable at the type level for the fail-closed       */
/* tests (the registry family doctrine).                               */
/* ------------------------------------------------------------------ */

export interface GateReceiptInput {
	verificationStatus?: unknown;
	checks?: unknown;
	[key: string]: unknown;
}

export interface GateDecisionInput {
	approver?: unknown;
	acknowledgedPermissions?: unknown;
	riskAcknowledged?: unknown;
	[key: string]: unknown;
}

export interface GateRefusal {
	code: string;
	law: string;
	entryId?: string | null;
	state?: string | null;
	detail?: string | null;
}

export type GateRefusalSource = "registry" | "gate";

export class GateError extends Error {
	readonly code: string;
	readonly law: string;
	readonly entryId: string | null;
	readonly state: string | null;
	readonly detail: string | null;
	readonly source: GateRefusalSource;

	constructor(refusal: GateRefusal, source: GateRefusalSource) {
		super(refusal.code + (refusal.detail === null || refusal.detail === undefined ? "" : ": " + refusal.detail));
		this.name = "GateError";
		this.code = refusal.code;
		this.law = refusal.law;
		this.entryId = refusal.entryId === undefined ? null : refusal.entryId;
		this.state = refusal.state === undefined ? null : refusal.state;
		this.detail = refusal.detail === undefined ? null : refusal.detail;
		this.source = source;
	}
}

export interface GateDisclosureView {
	readonly code: string;
	readonly note: string;
	readonly detail: string | null;
}

export interface GateOutcome {
	readonly ok: true;
	readonly entryId: string;
	readonly state: string;
	readonly disclosure: GateDisclosureView | null;
}

export interface GatePartialCensus {
	readonly receiptCount: number;
	readonly partialReceiptCount: number;
	readonly partialChecks: readonly { readonly checkId: string; readonly verdict: string }[];
}

export interface GateWarningView {
	readonly code: string;
	readonly note: string;
	readonly entryId: string;
	readonly at: number;
	readonly census: GatePartialCensus;
}

export interface GateEnableOutcome extends GateOutcome {
	readonly warning: GateWarningView | null;
}

export interface GateDecisionRecordView {
	readonly approver: string;
	readonly acknowledgedPermissions: readonly string[];
	readonly riskAcknowledged: boolean;
	readonly declaredPermissions: readonly string[];
	readonly highRiskPermissions: readonly string[];
	readonly at: number;
}

export interface GateDecisionOutcome {
	readonly ok: true;
	readonly entryId: string;
	readonly state: string;
	readonly recorded: GateDecisionRecordView;
}

export interface GatePermissionRiskView {
	readonly id: string;
	readonly riskTier: string | null;
}

export interface GateVerificationSummary {
	readonly status: string;
	readonly receiptCount: number;
	readonly receiptsByStatus: Readonly<Record<string, number>>;
	readonly partialChecks: readonly { readonly checkId: string; readonly verdict: string }[];
}

export interface GateApprovalView {
	readonly approver: string;
	readonly acknowledgedPermissions: readonly string[];
	readonly at: number;
	readonly scope: RegistryScope;
}

export interface GatePolicySummary {
	readonly entryId: string;
	readonly state: string;
	readonly contentHash: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly unavailableCause: string | null;
	readonly declaredPermissions: readonly GatePermissionRiskView[];
	readonly highRiskPermissions: readonly string[];
	readonly verification: GateVerificationSummary;
	readonly approval: GateApprovalView | null;
	readonly gateDecisions: readonly GateDecisionRecordView[];
	readonly gateWarnings: readonly GateWarningView[];
}

export interface GateRuntime {
	submitVerificationReceipt(entryId: string, receipt: GateReceiptInput): Promise<GateOutcome>;
	decidePermissions(entryId: string, decision: GateDecisionInput): Promise<GateDecisionOutcome>;
	approve(entryId: string): Promise<GateOutcome>;
	enable(entryId: string): Promise<GateEnableOutcome>;
	gatePolicySummary(entryId: string): Promise<GatePolicySummary>;
}

export interface GateOptions {
	root: string;
	clock: () => number;
	fsPort: FsPort;
	scope: RegistryScope;
}

export interface GateDeps {
	clock: () => number;
	fsPort: FsPort;
	scope: RegistryScope;
}

/* ------------------------------------------------------------------ */
/* Internals.                                                          */
/* ------------------------------------------------------------------ */

type GateRecordKind = "receipt" | "decision" | "warning";

interface DecisionEvidence {
	approver: string;
	acknowledgedPermissions: string[];
	riskAcknowledged: boolean;
	declaredPermissions: string[];
	highRiskPermissions: string[];
	at: number;
}

interface WarningEvidence {
	entryId: string;
	code: string;
	note: string;
	at: number;
	census: GatePartialCensus;
}

interface ParsedGateRecord {
	seq: number;
	at: number;
	kind: GateRecordKind;
	entryId: string;
	data: Record<string, unknown>;
}

const FROZEN_VERIFICATION_STATUSES: readonly string[] = VERIFICATION_STATUSES;

const GATE_RECORD_KINDS: readonly string[] = ["receipt", "decision", "warning"];

/* States that can only exist past a verified receipt. An `unavailable` */
/* entry may legitimately carry a non-verified status (the              */
/* verification-failed leg), so it is NOT in this list.                 */
const POST_VERIFICATION_STATES: readonly string[] = ["approved", "enabled", "available"];

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value !== "";
}

function toDisclosureView(disclosure: { code: string; note: string; detail?: string | null } | null): GateDisclosureView | null {
	if (disclosure === null) {
		return null;
	}
	return { code: disclosure.code, note: disclosure.note, detail: disclosure.detail === undefined ? null : disclosure.detail };
}

function toDecisionView(evidence: DecisionEvidence): GateDecisionRecordView {
	return {
		approver: evidence.approver,
		acknowledgedPermissions: [...evidence.acknowledgedPermissions],
		riskAcknowledged: evidence.riskAcknowledged,
		declaredPermissions: [...evidence.declaredPermissions],
		highRiskPermissions: [...evidence.highRiskPermissions],
		at: evidence.at
	};
}

function toWarningView(evidence: WarningEvidence): GateWarningView {
	return { code: evidence.code, note: evidence.note, entryId: evidence.entryId, at: evidence.at, census: evidence.census };
}

function plainCopy(value: unknown): Record<string, unknown> {
	return JSON.parse(canonicalJSON(value)) as Record<string, unknown>;
}

function collectPartialChecks(receipts: readonly { verificationStatus: string; checks?: unknown }[]): { checkId: string; verdict: string }[] {
	const checks: { checkId: string; verdict: string }[] = [];
	for (const receipt of receipts) {
		if (!Array.isArray(receipt.checks)) {
			continue;
		}
		for (const check of receipt.checks) {
			if (isObject(check) && isNonEmptyString(check.checkId) && isNonEmptyString(check.verdict)) {
				checks.push({ checkId: check.checkId, verdict: check.verdict });
			}
		}
	}
	return checks;
}

/* Gate-strict receipt validation (CR-008 4.2). The frozen status     */
/* vocabulary and the E_RECEIPT_MALFORMED law come from the registry's */
/* own frozen tables; the { checkId, verdict } check shape is the      */
/* gate's disclosed strictness beyond the machine's letter (the        */
/* machine checks array-ness, non-emptiness, and the status only).     */

function receiptRefusal(receipt: unknown, entryId: string, state: string): GateRefusal | null {
	if (!isObject(receipt)) {
		return refusalFor("E_RECEIPT_MALFORMED", { entryId: entryId, state: state, detail: "receipt is not an object" });
	}
	const status = receipt.verificationStatus;
	if (typeof status !== "string" || !FROZEN_VERIFICATION_STATUSES.includes(status)) {
		return refusalFor("E_RECEIPT_MALFORMED", { entryId: entryId, state: state, detail: "receipt.verificationStatus must be one of the frozen verification statuses" });
	}
	const checks = receipt.checks;
	if (checks === undefined || !Array.isArray(checks)) {
		return refusalFor("E_RECEIPT_MALFORMED", { entryId: entryId, state: state, detail: "receipt.checks must be a non-empty array of { checkId, verdict } checks (CR-008 4.2 gate strictness: the checks array is required)" });
	}
	if (checks.length === 0) {
		return refusalFor("E_RECEIPT_MALFORMED", { entryId: entryId, state: state, detail: "receipt.checks must not be empty" });
	}
	for (let index = 0; index < checks.length; index++) {
		const check: unknown = checks[index];
		if (!isObject(check) || !isNonEmptyString(check.checkId) || !isNonEmptyString(check.verdict)) {
			return refusalFor("E_RECEIPT_MALFORMED", { entryId: entryId, state: state, detail: "receipt.checks[" + index + "] must be an object shaped { checkId: non-empty string, verdict: non-empty string }" });
		}
	}
	return null;
}

/* The decision-shape refusals mirror the registry's approve messages  */
/* verbatim so the gate's pre-checks and the registry's own checks     */
/* fail identically.                                                   */

function decisionShapeRefusal(decision: unknown, entryId: string, state: string): GateRefusal | null {
	if (!isObject(decision)) {
		return refusalFor("E_APPROVAL_MALFORMED", { entryId: entryId, state: state, detail: "the approval decision must be an object" });
	}
	if (!isNonEmptyString(decision.approver)) {
		return refusalFor("E_APPROVAL_MALFORMED", { entryId: entryId, state: state, detail: "decision.approver must be a non-empty string" });
	}
	if (!Array.isArray(decision.acknowledgedPermissions)) {
		return refusalFor("E_APPROVAL_MALFORMED", { entryId: entryId, state: state, detail: "decision.acknowledgedPermissions must be an array" });
	}
	return null;
}

/* The registry's own acknowledgement computation, mirrored exactly    */
/* (missing + extra, sorted, the registry's detail format) so the      */
/* gate's pre-check refusal is equivalent to the registry's own.       */

function acknowledgementRefusal(declared: readonly string[], acknowledged: readonly unknown[], entryId: string, state: string): GateRefusal | null {
	const declaredAsUnknowns: readonly unknown[] = declared;
	const missing = declared.filter((permission) => !acknowledged.includes(permission)).sort();
	const extra = acknowledged.filter((permission) => !declaredAsUnknowns.includes(permission)).sort();
	if (missing.length > 0 || extra.length > 0) {
		return refusalFor("E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH", {
			entryId: entryId,
			state: state,
			detail: "unacknowledged declared permissions: [" + missing.join(", ") + "]; acknowledged undeclared permissions: [" + extra.join(", ") + "]"
		});
	}
	return null;
}

/* The ONE gate-owned law (CR-008 4.3).                                */

function highRiskRefusal(declared: readonly string[], riskAcknowledged: unknown, entryId: string, state: string): GateRefusal | null {
	const highRisk = declared.filter(isHighRiskPermission).sort();
	if (highRisk.length === 0) {
		return null;
	}
	if (riskAcknowledged !== true) {
		return {
			code: GATE_REFUSALS.E_HIGH_RISK_UNACKNOWLEDGED.code,
			law: GATE_REFUSALS.E_HIGH_RISK_UNACKNOWLEDGED.law,
			entryId: entryId,
			state: state,
			detail: "declared high-risk permissions [" + highRisk.join(", ") + "] require riskAcknowledged: true in the permission decision"
		};
	}
	return null;
}

/* ------------------------------------------------------------------ */
/* The gate runtime.                                                   */
/* ------------------------------------------------------------------ */

export async function createGate(options: GateOptions): Promise<GateRuntime> {
	/* Factory misuse throws TypeError, mirroring createRegistry.      */
	if (!isObject(options)) {
		throw new TypeError("createGate requires an options object");
	}
	if (typeof options.root !== "string" || options.root === "") {
		throw new TypeError("createGate: root must be a non-empty string");
	}
	const root = options.root.replace(/\/+$/, "");
	if (typeof options.clock !== "function") {
		throw new TypeError("createGate: clock must be a function");
	}
	const clock = options.clock;
	const fsPort = options.fsPort;
	if (!isObject(fsPort)) {
		throw new TypeError("createGate: fsPort must be an object");
	}
	for (const name of ["readFile", "writeFile", "appendFile", "mkdir", "readdir"] as const) {
		if (typeof fsPort[name] !== "function") {
			throw new TypeError("createGate: fsPort." + name + " must be a function");
		}
	}
	if (!isObject(options.scope)) {
		throw new TypeError("createGate: scope must be { workspaceId, tenantId }");
	}
	if (!isNonEmptyString(options.scope.workspaceId) || !isNonEmptyString(options.scope.tenantId)) {
		throw new TypeError("createGate: scope.workspaceId and scope.tenantId must be non-empty strings");
	}
	const scope = Object.freeze({ workspaceId: options.scope.workspaceId, tenantId: options.scope.tenantId });

	/* Law 4.1: the REAL registry over the SAME root - one journal.    */
	const registry = createRegistry({ root: root, clock: clock, fsPort: fsPort, scope: scope });
	const loadResult = await registry.load();
	if (!loadResult.ok) {
		throw new GateError(loadResult.refusal, "registry");
	}

	const gateDir = root + "/.flauz/gate";
	const recordsPath = gateDir + "/records.jsonl";
	await fsPort.mkdir(gateDir, { recursive: true });

	/* The gate's evidence state (never lifecycle state).             */
	const decisionsByEntry = new Map<string, DecisionEvidence[]>();
	const warningsByEntry = new Map<string, WarningEvidence[]>();
	let nextSeq = 1;

	const knownEntryIds = new Set<string>();
	const queryAll = await registry.query({});
	if (!queryAll.ok) {
		throw new GateError(queryAll.refusal, "registry");
	}
	for (const summary of queryAll.entries) {
		knownEntryIds.add(summary.entryId);
	}

	/* Replay the gate records under the registry's own fail-closed    */
	/* journal laws (verbatim codes + laws; details name the gate      */
	/* records file).                                                   */
	let recordsText: string | null = null;
	try {
		recordsText = await fsPort.readFile(recordsPath, "utf8");
	} catch (err) {
		if (isObject(err) && err.code === "ENOENT") {
			recordsText = null;
		} else {
			throw err;
		}
	}
	if (recordsText !== null && recordsText !== "") {
		if (recordsText.charAt(recordsText.length - 1) !== "\n") {
			throw gateJournalTorn("the gate records file does not end with a complete line");
		}
		const lines = recordsText.split("\n");
		if (lines.length > 0 && lines[lines.length - 1] === "") {
			lines.pop();
		}
		for (let index = 0; index < lines.length; index++) {
			const lineNo = index + 1;
			const raw = lines[index];
			if (raw === "") {
				throw gateJournalTorn("gate records line " + lineNo + " is empty");
			}
			let parsed: unknown = null;
			try {
				parsed = JSON.parse(raw);
			} catch {
				throw gateJournalTorn("gate records line " + lineNo + " is not valid JSON");
			}
			const record = parseRecordLine(parsed, lineNo);
			if (!knownEntryIds.has(record.entryId)) {
				throw new GateError(refusalFor("E_JOURNAL_UNLAWFUL", { detail: "gate records line " + lineNo + " references entry " + record.entryId + ", which the loaded registry does not know" }), "gate");
			}
			replayRecord(record);
			nextSeq = record.seq + 1;
		}
	}

	function gateJournalTorn(detail: string): GateError {
		return new GateError(refusalFor("E_JOURNAL_TORN", { detail: detail }), "gate");
	}

	function parseRecordLine(value: unknown, lineNo: number): ParsedGateRecord {
		if (!isObject(value)) {
			throw gateJournalTorn("gate records line " + lineNo + " is not a JSON object");
		}
		if (typeof value.seq !== "number" || !Number.isInteger(value.seq) || value.seq !== lineNo) {
			throw gateJournalTorn("gate records line " + lineNo + " has sequence " + String(value.seq) + "; gate records lines are missing or out of order");
		}
		if (typeof value.at !== "number" || !Number.isFinite(value.at)) {
			throw gateJournalTorn("gate records line " + lineNo + " has no finite timestamp");
		}
		const recordScope = value.scope;
		if (!isObject(recordScope) || recordScope.workspaceId !== scope.workspaceId || recordScope.tenantId !== scope.tenantId) {
			throw new GateError(refusalFor("E_SNAPSHOT_MISMATCH", { detail: "gate records line " + lineNo + " belongs to a different scope" }), "gate");
		}
		if (value.contractVersion !== GATE_CONTRACT_VERSION) {
			throw new GateError(refusalFor("E_SNAPSHOT_MISMATCH", { detail: "gate records line " + lineNo + " carries contract version " + String(value.contractVersion) }), "gate");
		}
		if (typeof value.kind !== "string" || !GATE_RECORD_KINDS.includes(value.kind)) {
			throw gateJournalTorn("gate records line " + lineNo + " is structurally invalid (unknown record kind)");
		}
		const kind = value.kind as GateRecordKind;
		if (!isNonEmptyString(value.entryId)) {
			throw gateJournalTorn("gate records line " + lineNo + " is structurally invalid (entryId)");
		}
		if (!isObject(value.data)) {
			throw gateJournalTorn("gate records line " + lineNo + " is structurally invalid (data)");
		}
		validateRecordData(kind, value.data, lineNo);
		return { seq: value.seq, at: value.at, kind: kind, entryId: value.entryId, data: value.data };
	}

	function validateRecordData(kind: GateRecordKind, data: Record<string, unknown>, lineNo: number): void {
		if (kind === "decision") {
			if (!isNonEmptyString(data.approver) || !Array.isArray(data.acknowledgedPermissions) || typeof data.riskAcknowledged !== "boolean" || !Array.isArray(data.declaredPermissions) || !Array.isArray(data.highRiskPermissions)) {
				throw gateJournalTorn("gate records line " + lineNo + ": decision record data is structurally invalid");
			}
			return;
		}
		if (kind === "receipt") {
			if (!isObject(data.receipt) || typeof data.state !== "string" || !(data.disclosureCode === null || typeof data.disclosureCode === "string")) {
				throw gateJournalTorn("gate records line " + lineNo + ": receipt record data is structurally invalid");
			}
			return;
		}
		const census = data.census;
		if (data.reason !== "verified-partial" || !isObject(census) || typeof census.receiptCount !== "number" || typeof census.partialReceiptCount !== "number" || !Array.isArray(census.partialChecks)) {
			throw gateJournalTorn("gate records line " + lineNo + ": warning record data is structurally invalid");
		}
	}

	function replayRecord(record: ParsedGateRecord): void {
		if (record.kind === "decision") {
			const data = record.data;
			pushDecision(record.entryId, {
				approver: data.approver as string,
				acknowledgedPermissions: asStringList(data.acknowledgedPermissions),
				riskAcknowledged: data.riskAcknowledged === true,
				declaredPermissions: asStringList(data.declaredPermissions),
				highRiskPermissions: asStringList(data.highRiskPermissions),
				at: record.at
			});
			return;
		}
		if (record.kind === "warning") {
			const censusData = record.data.census as Record<string, unknown>;
			pushWarning(record.entryId, {
				entryId: record.entryId,
				code: GATE_WARNINGS.W_ENABLE_VERIFICATION_PARTIAL.code,
				note: GATE_WARNINGS.W_ENABLE_VERIFICATION_PARTIAL.note,
				at: record.at,
				census: {
					receiptCount: censusData.receiptCount as number,
					partialReceiptCount: censusData.partialReceiptCount as number,
					partialChecks: asCheckList(censusData.partialChecks)
				}
			});
		}
		/* kind === "receipt": durable decision evidence only; the      */
		/* registry journal already holds the authoritative receipt.     */
	}

	function asStringList(value: unknown): string[] {
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
	}

	function asCheckList(value: unknown): { checkId: string; verdict: string }[] {
		if (!Array.isArray(value)) {
			return [];
		}
		const checks: { checkId: string; verdict: string }[] = [];
		for (const item of value) {
			if (isObject(item) && isNonEmptyString(item.checkId) && isNonEmptyString(item.verdict)) {
				checks.push({ checkId: item.checkId, verdict: item.verdict });
			}
		}
		return checks;
	}

	function pushDecision(entryId: string, evidence: DecisionEvidence): void {
		const list = decisionsByEntry.get(entryId);
		if (list === undefined) {
			decisionsByEntry.set(entryId, [evidence]);
		} else {
			list.push(evidence);
		}
	}

	function pushWarning(entryId: string, evidence: WarningEvidence): void {
		const list = warningsByEntry.get(entryId);
		if (list === undefined) {
			warningsByEntry.set(entryId, [evidence]);
		} else {
			list.push(evidence);
		}
	}

	async function appendRecord(kind: GateRecordKind, entryId: string, data: Record<string, unknown>): Promise<{ at: number }> {
		const record = {
			seq: nextSeq,
			at: clock(),
			scope: scope,
			contractVersion: GATE_CONTRACT_VERSION,
			kind: kind,
			entryId: entryId,
			data: data
		};
		await fsPort.appendFile(recordsPath, canonicalJSON(record) + "\n");
		nextSeq += 1;
		return { at: record.at };
	}

	async function readEntry(entryId: string): Promise<RegistryEntryView> {
		const result = await registry.inspect(entryId);
		if (!result.ok) {
			throw new GateError(result.refusal, "registry");
		}
		return result.entry;
	}

	function declaredPermissionsOf(entry: RegistryEntryView): string[] {
		return entry.imported === null ? [] : [...entry.imported.permissions];
	}

	async function submitVerificationReceipt(entryId: string, receipt: GateReceiptInput): Promise<GateOutcome> {
		const entry = await readEntry(entryId);
		const refusal = receiptRefusal(receipt, entry.entryId, entry.state);
		if (refusal !== null) {
			throw new GateError(refusal, "gate");
		}
		/* The registry drives the lifecycle: no cause is passed - the   */
		/* machine derives the verification-failed -> unavailable leg    */
		/* (and its cause) itself (state.mjs applyTransition).           */
		const result = await registry.verify(entryId, receipt as VerificationReceiptInput);
		if (!result.ok) {
			throw new GateError(result.refusal, "registry");
		}
		/* Evidence (not lifecycle state): record the submitted receipt  */
		/* and what the registry did with it - including non-advancing   */
		/* disclosures, which the registry journals too.                 */
		await appendRecord("receipt", entry.entryId, {
			receipt: plainCopy(receipt),
			state: result.state,
			disclosureCode: result.disclosure === null ? null : result.disclosure.code
		});
		return { ok: true, entryId: result.entryId, state: result.state, disclosure: toDisclosureView(result.disclosure) };
	}

	async function decidePermissions(entryId: string, decision: GateDecisionInput): Promise<GateDecisionOutcome> {
		const entry = await readEntry(entryId);
		const shapeRefusal = decisionShapeRefusal(decision, entry.entryId, entry.state);
		if (shapeRefusal !== null) {
			throw new GateError(shapeRefusal, "gate");
		}
		const declared = declaredPermissionsOf(entry);
		const acknowledged = decision.acknowledgedPermissions as readonly unknown[];
		/* Pre-check (CR-008 4.3): when the mismatch is provable from    */
		/* the read view, refuse WITHOUT attempting the registry call.   */
		const mismatchRefusal = acknowledgementRefusal(declared, acknowledged, entry.entryId, entry.state);
		if (mismatchRefusal !== null) {
			throw new GateError(mismatchRefusal, "gate");
		}
		/* The gate-owned high-risk law (CR-008 4.3).                    */
		const riskRefusal = highRiskRefusal(declared, decision.riskAcknowledged, entry.entryId, entry.state);
		if (riskRefusal !== null) {
			throw new GateError(riskRefusal, "gate");
		}
		const evidence: DecisionEvidence = {
			approver: decision.approver as string,
			acknowledgedPermissions: declared.filter((permission) => acknowledged.includes(permission)).sort(),
			riskAcknowledged: decision.riskAcknowledged === true,
			declaredPermissions: [...declared],
			highRiskPermissions: declared.filter(isHighRiskPermission).sort(),
			at: clock()
		};
		await appendRecord("decision", entry.entryId, {
			approver: evidence.approver,
			acknowledgedPermissions: evidence.acknowledgedPermissions,
			riskAcknowledged: evidence.riskAcknowledged,
			declaredPermissions: evidence.declaredPermissions,
			highRiskPermissions: evidence.highRiskPermissions
		});
		pushDecision(entry.entryId, evidence);
		/* A decision is evidence, not lifecycle: this call reads the     */
		/* state; it never changes it.                                   */
		return { ok: true, entryId: entry.entryId, state: entry.state, recorded: toDecisionView(evidence) };
	}

	async function approve(entryId: string): Promise<GateOutcome> {
		const entry = await readEntry(entryId);
		const decisions = decisionsByEntry.get(entry.entryId);
		if (decisions === undefined || decisions.length === 0) {
			throw new GateError(refusalFor("E_APPROVAL_MALFORMED", {
				entryId: entry.entryId,
				state: entry.state,
				detail: "no permission decision is recorded for this entry; decidePermissions(entryId, decision) first (CR-008 4.3)"
			}), "gate");
		}
		const decision = decisions[decisions.length - 1];
		/* Re-validate the recorded decision against the entry's CURRENT */
		/* declared permissions (fail-closed pre-check; declared          */
		/* permissions are immutable after register, but a decision may   */
		/* predate the register).                                        */
		const declared = declaredPermissionsOf(entry);
		const mismatchRefusal = acknowledgementRefusal(declared, decision.acknowledgedPermissions, entry.entryId, entry.state);
		if (mismatchRefusal !== null) {
			throw new GateError(mismatchRefusal, "gate");
		}
		const riskRefusal = highRiskRefusal(declared, decision.riskAcknowledged, entry.entryId, entry.state);
		if (riskRefusal !== null) {
			throw new GateError(riskRefusal, "gate");
		}
		const result = await registry.approve(entryId, {
			approver: decision.approver,
			acknowledgedPermissions: decision.acknowledgedPermissions
		});
		if (!result.ok) {
			throw new GateError(result.refusal, "registry");
		}
		return { ok: true, entryId: result.entryId, state: result.state, disclosure: toDisclosureView(result.disclosure) };
	}

	async function enable(entryId: string): Promise<GateEnableOutcome> {
		const entry = await readEntry(entryId);
		/* Defensive, disclosed as unreachable per the machine invariant: */
		/* a state that can only exist past a verified receipt reading    */
		/* with a non-verified status implies the read view diverges      */
		/* from the journal. (An `unavailable` entry may legitimately     */
		/* carry verification-failed, so it is excluded.)                 */
		if (POST_VERIFICATION_STATES.includes(entry.state) && entry.verification.status !== "verified") {
			throw new GateError(refusalFor("E_JOURNAL_UNLAWFUL", {
				entryId: entry.entryId,
				state: entry.state,
				detail: "the entry reads as " + entry.state + " with verification status " + entry.verification.status + "; the machine cannot grant this view, so the read view diverges from the journal"
			}), "gate");
		}
		const partialReceipts = entry.verification.receipts.filter((receipt) => receipt.verificationStatus === "verified-partial");
		const partialChecks = collectPartialChecks(partialReceipts);
		const result = await registry.enable(entryId);
		if (!result.ok) {
			throw new GateError(result.refusal, "registry");
		}
		let warning: GateWarningView | null = null;
		if (partialReceipts.length > 0) {
			const census: GatePartialCensus = {
				receiptCount: entry.verification.receipts.length,
				partialReceiptCount: partialReceipts.length,
				partialChecks: partialChecks
			};
			const written = await appendRecord("warning", entry.entryId, {
				reason: "verified-partial",
				census: { receiptCount: census.receiptCount, partialReceiptCount: census.partialReceiptCount, partialChecks: census.partialChecks }
			});
			const evidence: WarningEvidence = {
				entryId: entry.entryId,
				code: GATE_WARNINGS.W_ENABLE_VERIFICATION_PARTIAL.code,
				note: GATE_WARNINGS.W_ENABLE_VERIFICATION_PARTIAL.note,
				at: written.at,
				census: census
			};
			pushWarning(entry.entryId, evidence);
			warning = toWarningView(evidence);
		}
		return { ok: true, entryId: result.entryId, state: result.state, disclosure: toDisclosureView(result.disclosure), warning: warning };
	}

	async function gatePolicySummary(entryId: string): Promise<GatePolicySummary> {
		const entry = await readEntry(entryId);
		const declared = declaredPermissionsOf(entry);
		const receiptsByStatus: Record<string, number> = {};
		for (const status of FROZEN_VERIFICATION_STATUSES) {
			receiptsByStatus[status] = 0;
		}
		for (const receipt of entry.verification.receipts) {
			const status = receipt.verificationStatus;
			receiptsByStatus[status] = (receiptsByStatus[status] ?? 0) + 1;
		}
		const partialReceipts = entry.verification.receipts.filter((receipt) => receipt.verificationStatus === "verified-partial");
		const decisions = decisionsByEntry.get(entry.entryId) ?? [];
		const warnings = warningsByEntry.get(entry.entryId) ?? [];
		return {
			entryId: entry.entryId,
			state: entry.state,
			contentHash: entry.contentHash,
			createdAt: entry.createdAt,
			updatedAt: entry.updatedAt,
			unavailableCause: entry.unavailableCause,
			declaredPermissions: declared.map((permission) => ({ id: permission, riskTier: permissionRiskTier(permission) })),
			highRiskPermissions: declared.filter(isHighRiskPermission).sort(),
			verification: {
				status: entry.verification.status,
				receiptCount: entry.verification.receipts.length,
				receiptsByStatus: receiptsByStatus,
				partialChecks: collectPartialChecks(partialReceipts)
			},
			approval: entry.approval === null ? null : {
				approver: entry.approval.approver,
				acknowledgedPermissions: entry.approval.acknowledgedPermissions,
				at: entry.approval.at,
				scope: entry.approval.scope
			},
			gateDecisions: decisions.map(toDecisionView),
			gateWarnings: warnings.map(toWarningView)
		};
	}

	return {
		submitVerificationReceipt: submitVerificationReceipt,
		decidePermissions: decidePermissions,
		approve: approve,
		enable: enable,
		gatePolicySummary: gatePolicySummary
	};
}

/* The documented restart seam (CR-008 4.6): the same construction,    */
/* replaying the registry journal plus the gate records.               */

export async function loadGate(root: string, deps: GateDeps): Promise<GateRuntime> {
	return createGate({ root: root, clock: deps.clock, fsPort: deps.fsPort, scope: deps.scope });
}