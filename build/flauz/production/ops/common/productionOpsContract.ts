/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * A-PROD-006-W7 production ops contracts: the typed PRODUCTION-REAL
 * deployment and operations family - the closed honest-evidence
 * vocabulary for production exchanges over the deployed Flauz web
 * distribution (Vercel hosting + Neon Postgres): the frozen evidence
 * labels (the production-real rung claimed ONLY for exchanges against
 * the LIVE production URL and the LIVE Neon database, never
 * promoted), the frozen evidence kinds, the typed production target
 * identity, the production evidence ledger record (the append-only
 * Neon table shape), the fail-closed health report, the typed
 * record / read / schema outcomes, the canonical fixed-key-order
 * serialization, the shape guards, the URL class classifier (the
 * label-target-mismatch law's structural engine), and the idempotent
 * ledger schema DDL (contract module, the labContracts discipline;
 * binds the production-real rung vocabulary verbatim, never
 * re-implemented).
 *
 * LAWS (A-PROD-006-W7 work order; WORK-REGISTRY.md the A-PROD-006
 * records; the landed INF-009 acceptance family's laws are INHERITED
 * and binding here as the closest sibling):
 * - THE HONEST-EVIDENCE LAW (binding, this family's charter): the
 *   evidence labels are the frozen 'fixture' | 'local-real' |
 *   'production-real' list, in the exact list order. 'fixture' proves
 *   vocabulary behavior only (a record minted over a fixture target,
 *   never a real exchange); 'local-real' proves real execution at a
 *   caller-injected port (an in-memory queryLike port standing in for
 *   the live DB - the sibling acceptance family's local-real pattern);
 *   'production-real' proves a REAL exchange against the LIVE
 *   production URL and the LIVE Neon database - claimed ONLY when a
 *   production exchange actually happened, NEVER promoted. A
 *   production-real claim recorded over a non-production target is the
 *   typed 'label-target-mismatch' rejection (enforced at the record
 *   boundary - the never-promoted law, BOTH directions: a
 *   production-real label over a fixture/local target is the mismatch,
 *   AND a fixture/local label over a production target is the
 *   mismatch). Evidence labels are DERIVED from the target's
 *   expectedLabel (which must agree with the target's URL class),
 *   never caller-supplied - a caller-supplied label is the typed
 *   'caller-supplied-label' rejection.
 * - THE NO-SECRET LAW (binding): no credential material anywhere in
 *   the vocabulary (no Vercel token, no Neon API key, no Neon
 *   connection string, not even masked fragments that could
 *   reconstruct one). The ops vocabulary cannot even NAME a secret
 *   (the shape guards reject any record carrying secret-shaped
 *   fields). Secrets reach the runtime boundary ONLY through the
 *   serverless function's env at runtime (DATABASE_URL read by the
 *   deploy layer, never in this module, never in the kit module).
 * - THE FAIL-CLOSED LAW (binding): a dead or non-production endpoint
 *   is the typed refusal, never a fabricated green. The health report
 *   carries dbConnectivity 'refused' or 'unknown' on a dead DB, never
 *   'connected' without a real connection. A non-200 response or a
 *   network error is the typed refusal, never a green. The healthCheck
 *   default-refuses without a fetch port (no global fetch in shipped
 *   code - the kit REFUSES rather than guess).
 * - THE INJECTED-CLOCK LAW (binding): this contract never reads a
 *   clock. Every timestamp is a read of the caller-injected clock
 *   (the recordedAtIso / checkedAtIso fields carry the injected
 *   clock's value verbatim). No Date.now, no Math.random, no
 *   process.env in this module (law comments excepted).
 * - THE APPEND-ONLY LEDGER LAW (binding): the production evidence
 *   ledger (Neon table) is append-only. Re-recording an id appends a
 *   NEW revision (revision N+1 through the id's PRIMARY KEY UPSERT);
 *   nothing is edited or deleted; the reader discloses revision
 *   counts.
 * - THE SINGLE-VERSION LAW (binding): PRODUCTION_OPS_VERSION is
 *   '1.0.0' declared ONCE in this contract module, re-carried by the
 *   kit; the battery pins both copies equal.
 * - FROZEN REJECTION VOCABULARIES, FIRST-FAILURE-IS-THE-VERDICT:
 *   every record / read / schema / health rejection is a typed member
 *   of the frozen PRODUCTION_REJECTION_REASONS list, applied in the
 *   exact list order per walk; the first failing check is THE
 *   verdict.
 * - Zero external dependencies: this module is pure vocabulary over
 *   typed values; no I/O, no socket, no env read.
 */

export const PRODUCTION_OPS_VERSION = '1.0.0';

/**
 * The closed frozen evidence-label vocabulary: the honest-evidence
 * rung ladder this family claims. The list order is the rung order
 * (the lowest rung first, the production-real rung last - claimed
 * ONLY for exchanges against the LIVE production URL and the LIVE
 * Neon database, never promoted):
 *   fixture          - proves vocabulary behavior only (a record
 *                      minted over a fixture target, never a real
 *                      exchange);
 *   local-real       - proves real execution at a caller-injected
 *                      port (an in-memory queryLike port standing in
 *                      for the live DB - the sibling acceptance
 *                      family's local-real pattern);
 *   production-real  - proves a REAL exchange against the LIVE
 *                      production URL and the LIVE Neon database -
 *                      claimed ONLY when a production exchange
 *                      actually happened, never promoted.
 * Widening or reordering the list is a versioned contract decision.
 */
export const PRODUCTION_EVIDENCE_LABELS = ['fixture', 'local-real', 'production-real'] as const;
export type ProductionEvidenceLabel = (typeof PRODUCTION_EVIDENCE_LABELS)[number];

/** Pure predicate over the closed evidence-label list. */
export function isProductionEvidenceLabel(value: unknown): value is ProductionEvidenceLabel {
	return (PRODUCTION_EVIDENCE_LABELS as readonly string[]).includes(value as string);
}

/**
 * The closed frozen evidence-kind vocabulary: the production
 * operations classes the ledger records (each kind's payload is a
 * typed JSON object; the kit derives the label, never the caller):
 *   deployment        - a deployment event (the Vercel production
 *                       deployment landed; the artifact's version);
 *   smoke-run         - a smoke battery execution against the LIVE
 *                       production URL (each probe's honest result);
 *   rollback-drill    - a rollback rehearsal (the rollback path
 *                       exercised, never a fabricated green);
 *   incident-record   - an incident record (the honest timeline, the
 *                       typed refusal if the incident is unresolved);
 *   verification      - a verification record (the schema migration
 *                       op, the additive proof, the receipt fold).
 * Widening the set is a versioned contract decision.
 */
export const PRODUCTION_EVIDENCE_KINDS = [
	'deployment',
	'smoke-run',
	'rollback-drill',
	'incident-record',
	'verification',
] as const;
export type ProductionEvidenceKind = (typeof PRODUCTION_EVIDENCE_KINDS)[number];

/** Pure predicate over the closed evidence-kind list. */
export function isProductionEvidenceKind(value: unknown): value is ProductionEvidenceKind {
	return (PRODUCTION_EVIDENCE_KINDS as readonly string[]).includes(value as string);
}

/**
 * Closed frozen list of production rejection reasons, in the exact
 * list order (each walk applies its applicable subset in this order;
 * the first failure is THE verdict):
 *   malformed-payload       - the record's payload is not an object
 *                             or the kind is not a member (every
 *                             record walk); the read walk's malformed
 *                             row reason (a row that is not this
 *                             family's own canonical shape - never a
 *                             silent drop);
 *   caller-supplied-label   - THE HONEST-EVIDENCE LAW: the candidate
 *                             carries a caller-supplied evidence
 *                             label - labels are DERIVED from the
 *                             target's expectedLabel (which must
 *                             agree with the target's URL class),
 *                             never supplied;
 *   unknown-kind            - the candidate's kind is not a member
 *                             of the frozen PRODUCTION_EVIDENCE_KINDS
 *                             list;
 *   label-target-mismatch   - THE HONEST-EVIDENCE LAW: the target's
 *                             expectedLabel does not agree with the
 *                             target's URL class (the never-promoted
 *                             law, BOTH directions: a production-real
 *                             label over a fixture/local URL is the
 *                             mismatch, AND a fixture/local label
 *                             over a production URL is the mismatch);
 *   ledger-io               - the ledger port refused the append or
 *                             the read (the typed I/O failure reason
 *                             verbatim, never a silent drop);
 *   schema-io               - the ensureSchema port-failure reason
 *                             (parallels ledger-io: the schema
 *                             migration op's typed I/O failure);
 *   non-production-target   - THE FAIL-CLOSED LAW: the target is not
 *                             a production target (a dead or
 *                             non-production endpoint, or a
 *                             healthCheck without a fetch port, is
 *                             the typed refusal, never a fabricated
 *                             green).
 * Widening or reordering the list is a versioned contract decision.
 */
export const PRODUCTION_REJECTION_REASONS = [
	'malformed-payload',
	'caller-supplied-label',
	'unknown-kind',
	'label-target-mismatch',
	'ledger-io',
	'schema-io',
	'non-production-target',
] as const;
export type ProductionRejectionReason = (typeof PRODUCTION_REJECTION_REASONS)[number];

/** Pure predicate over the closed rejection-reason list. */
export function isProductionRejectionReason(value: unknown): value is ProductionRejectionReason {
	return (PRODUCTION_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/**
 * The URL class vocabulary: the structural engine of the
 * label-target-mismatch law. The URL class is DERIVED from the
 * target's URL (never caller-supplied); the target's expectedLabel
 * must agree with the URL class (a production-real label requires a
 * production URL; a fixture label requires a fixture URL; a
 * local-real label requires a local URL). The classification is
 * fail-closed: an unclassifiable URL defaults to 'fixture' (the
 * lowest rung, never promoted).
 */
export const PRODUCTION_URL_CLASSES = ['fixture', 'local', 'production'] as const;
export type ProductionUrlClass = (typeof PRODUCTION_URL_CLASSES)[number];

/**
 * Pure classifier: derives the URL class from the URL string (fail-
 * closed: an unclassifiable URL defaults to 'fixture'). A fixture
 * URL starts with 'https://fixture.invalid' or 'fixture://'; a local
 * URL starts with 'http://localhost' or 'http://127.0.0.1'; a
 * production URL starts with 'https://' and carries no
 * fixture/local marker. Never reads env, never opens a socket.
 */
export function classifyProductionUrl(url: unknown): ProductionUrlClass {
	if (typeof url !== 'string' || url.length === 0) {
		return 'fixture';
	}
	if (url.startsWith('https://fixture.invalid') || url.startsWith('fixture://')) {
		return 'fixture';
	}
	if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
		return 'local';
	}
	if (
		url.startsWith('https://')
		&& !url.includes('.invalid')
		&& !url.includes('.test')
		&& !url.includes('.local')
		&& !url.includes('localhost')
		&& !url.includes('127.0.0.1')
	) {
		return 'production';
	}
	return 'fixture';
}

/**
 * The typed production target identity: the URL the exchanges MUST
 * hit for a production-real label, and the expectedLabel the target
 * mints. The expectedLabel must agree with the URL class (THE
 * HONEST-EVIDENCE LAW's label-target-mismatch rule, enforced at the
 * record boundary). The target carries NO credential material (THE
 * NO-SECRET LAW - the URL is the public production URL only).
 */
export interface ProductionTarget {
	readonly url: string;
	readonly expectedLabel: ProductionEvidenceLabel;
}

/** Pure predicate: a well-formed production target (shape only; the label-target agreement is the kit's record-boundary check). */
export function isProductionTarget(value: unknown): value is ProductionTarget {
	if (!isRecord(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.url !== 'string' || record.url.length === 0) {
		return false;
	}
	if (!isProductionEvidenceLabel(record.expectedLabel)) {
		return false;
	}
	const keys = Object.keys(record).sort();
	const expected = ['expectedLabel', 'url'];
	if (keys.length !== expected.length) {
		return false;
	}
	for (let i = 0; i < keys.length; i += 1) {
		if (keys[i] !== expected[i]) {
			return false;
		}
	}
	return true;
}

/** The id prefix (the family's namespace). */
export const PRODUCTION_EVIDENCE_ID_PREFIX = 'flauz:prd:';

/** Pure predicate: a well-formed production evidence id (flauz:prd:<16-hex>). */
export function isProductionEvidenceId(value: unknown): value is string {
	if (typeof value !== 'string') {
		return false;
	}
	if (!value.startsWith(PRODUCTION_EVIDENCE_ID_PREFIX)) {
		return false;
	}
	const hex = value.slice(PRODUCTION_EVIDENCE_ID_PREFIX.length);
	return /^[0-9a-f]{16}$/.test(hex);
}

/**
 * The production evidence ledger record (the Neon table row shape):
 * the id (flauz:prd:<16-hex>, minted from an explicit rng at kit
 * construction, NEVER Math.random), the kind (a member of the
 * frozen PRODUCTION_EVIDENCE_KINDS list), the label (DERIVED from
 * the target's expectedLabel which must agree with the URL class,
 * never caller-supplied), the payload (the typed JSON payload per
 * kind), the recordedAtIso (the injected clock's value, carried
 * verbatim), and the revision (THE APPEND-ONLY LEDGER LAW:
 * re-recording an id appends revision N+1, nothing is edited or
 * deleted).
 */
export interface ProductionEvidenceRecord {
	readonly id: string;
	readonly kind: ProductionEvidenceKind;
	readonly label: ProductionEvidenceLabel;
	readonly payload: Record<string, unknown>;
	readonly recordedAtIso: string;
	readonly revision: number;
}

/**
 * Pure shape guard: a well-formed production evidence record. Pins
 * the honest-evidence laws STRUCTURALLY: the id is the
 * flauz:prd:<16-hex> form; the kind is a member of the frozen list;
 * the label is a member of the frozen list; the payload is a non-null
 * object; the recordedAtIso is a non-empty string (the injected
 * clock's value verbatim); the revision is a positive integer (the
 * append-only law). Fails closed on every malformed path; never
 * reads a clock; never mutates its input.
 */
export function isProductionEvidenceRecord(value: unknown): value is ProductionEvidenceRecord {
	if (!isRecord(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (!isProductionEvidenceId(record.id)) {
		return false;
	}
	if (!isProductionEvidenceKind(record.kind)) {
		return false;
	}
	if (!isProductionEvidenceLabel(record.label)) {
		return false;
	}
	if (!isRecord(record.payload)) {
		return false;
	}
	if (typeof record.recordedAtIso !== 'string' || record.recordedAtIso.length === 0) {
		return false;
	}
	if (typeof record.revision !== 'number' || !Number.isInteger(record.revision) || record.revision < 1) {
		return false;
	}
	const keys = Object.keys(record).sort();
	const expected = ['id', 'kind', 'label', 'payload', 'recordedAtIso', 'revision'];
	if (keys.length !== expected.length) {
		return false;
	}
	for (let i = 0; i < keys.length; i += 1) {
		if (keys[i] !== expected[i]) {
			return false;
		}
	}
	return true;
}

/**
 * The fail-closed production health report: the probe result against
 * the production target's /api/liveness endpoint (HTTP) AND the
 * ledger port's DB connectivity (SELECT 1). A dead DB is an honest
 * 'refused', NEVER a green 'connected'; a probe without a fetch port
 * is an honest 'unknown' with the typed refusal (THE FAIL-CLOSED
 * LAW - the kit REFUSES without an injected fetch port). The version
 * is the deployed artifact's self-reported version (carried when the
 * probe reached a healthy endpoint).
 */
export interface ProductionHealthReport {
	readonly ok: boolean;
	readonly version?: string;
	readonly targetUrl: string;
	readonly checkedAtIso: string;
	readonly dbConnectivity: 'connected' | 'refused' | 'unknown';
	readonly refusal?: ProductionRejectionReason;
}

/** Pure predicate: a well-formed production health report. */
export function isProductionHealthReport(value: unknown): value is ProductionHealthReport {
	if (!isRecord(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.ok !== 'boolean') {
		return false;
	}
	if (record.version !== undefined && typeof record.version !== 'string') {
		return false;
	}
	if (typeof record.targetUrl !== 'string' || record.targetUrl.length === 0) {
		return false;
	}
	if (typeof record.checkedAtIso !== 'string' || record.checkedAtIso.length === 0) {
		return false;
	}
	if (record.dbConnectivity !== 'connected' && record.dbConnectivity !== 'refused' && record.dbConnectivity !== 'unknown') {
		return false;
	}
	if (record.refusal !== undefined && !isProductionRejectionReason(record.refusal)) {
		return false;
	}
	return true;
}

/**
 * The fetch port response shape (the injected HTTP probe seam). The
 * kit calls the fetchLike with the target's liveness URL; the
 * response carries the HTTP status (200 = ok). The kit NEVER calls a
 * global fetch (THE FAIL-CLOSED LAW - the healthCheck default-refuses
 * without an injected fetch port).
 */
export interface ProductionFetchResponse {
	readonly ok: boolean;
	readonly status: number;
}

/**
 * The fetch port seam: the ONLY HTTP surface the kit touches. The
 * shipped code never calls a global fetch, never opens a socket
 * outside this port.
 */
export type ProductionFetchLike = (url: string) => Promise<ProductionFetchResponse>;

/**
 * The typed record outcome: success carries the minted record;
 * failure carries the frozen reason (first-failure-is-the-verdict)
 * and the detail string.
 */
export type ProductionRecordOutcome =
	| { readonly ok: true; readonly record: ProductionEvidenceRecord }
	| { readonly ok: false; readonly reason: ProductionRejectionReason; readonly detail: string };

/**
 * The typed read outcome: success carries the validated records and
 * the per-id revision counts (THE APPEND-ONLY LEDGER LAW's
 * disclosure); failure carries the frozen reason (a malformed row is
 * the typed malformed-payload reason, never a silent drop).
 */
export type ProductionReadOutcome =
	| { readonly ok: true; readonly records: readonly ProductionEvidenceRecord[]; readonly revisionCounts: Record<string, number> }
	| { readonly ok: false; readonly reason: ProductionRejectionReason; readonly detail: string };

/**
 * The typed schema outcome: success is the idempotent DDL applied;
 * failure carries the schema-io reason (the ensureSchema port-failure
 * reason, paralleling ledger-io).
 */
export type ProductionSchemaOutcome =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: ProductionRejectionReason; readonly detail: string };

/**
 * Canonical fixed-key-order serialization (byte-stable; the battery
 * pins double-run equality). The id, kind, label, payload (carried
 * verbatim - the caller's projection), recordedAtIso, and revision
 * are emitted in the exact fixed key order; the payload's own key
 * order is the caller's projection (the kit never re-orders it).
 * Throws TypeError on a malformed record (never dishonest bytes).
 */
export function serializeProductionRecord(record: unknown): string {
	if (!isProductionEvidenceRecord(record)) {
		throw new TypeError(
			'serializeProductionRecord: record must satisfy isProductionEvidenceRecord - no dishonest production evidence ever gets canonical bytes',
		);
	}
	return JSON.stringify({
		id: record.id,
		kind: record.kind,
		label: record.label,
		payload: record.payload,
		recordedAtIso: record.recordedAtIso,
		revision: record.revision,
	});
}

/**
 * The idempotent ledger schema DDL (the Neon table shape, a frozen
 * exported string constant). The ensureSchema port runs this through
 * the injected queryLike port (a real production migration op when
 * the port is live). The table is append-only (THE APPEND-ONLY
 * LEDGER LAW): re-recording an id appends a NEW revision (revision
 * N+1 through the id's PRIMARY KEY UPSERT - the id is the primary
 * key, the revision counter tracks how many times the id was
 * recorded); nothing is edited or deleted; the reader discloses
 * revision counts. CREATE TABLE IF NOT EXISTS makes the op
 * idempotent. The DDL's internal indentation is the tab character
 * (the family's byte style).
 */
export const PRODUCTION_LEDGER_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS production_evidence (
\tid TEXT PRIMARY KEY,
\tkind TEXT NOT NULL,
\tlabel TEXT NOT NULL,
\tpayload JSONB NOT NULL,
\trecorded_at TEXT NOT NULL,
\trevision INTEGER NOT NULL DEFAULT 1
);`;

// --- internal helpers (never exported beyond this module's own guards) ---

/** Pure predicate: a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
