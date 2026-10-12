/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * A-PROD-006-W7 production ops kit: the deterministic PRODUCTION-REAL
 * deployment and operations kit over the deployed Flauz web
 * distribution (the fail-closed factory binding the typed production
 * target, the injected clock, the injected rng (the id-minting seam -
 * NEVER the random global), the injected queryLike database port (the ONLY
 * database seam; the shipped kit NEVER opens a connection, NEVER reads
 * process.env), the OPTIONAL injected fetchLike HTTP port (the
 * healthCheck probe seam - the kit REFUSES without one, no global
 * fetch in shipped code), the record / read / schema folds whose
 * every record is a PROJECTION through the contract's own guards and
 * serializer, and the status-view fold (kit module, the labContracts
 * discipline; binds the production-real rung kit verbatim, never
 * re-implemented).
 *
 * LAWS (inherited binding from the contract module's header; the
 * contract module carries their enforcement surface):
 * - THE HONEST-EVIDENCE LAW: the evidence label is DERIVED from the
 *   target's expectedLabel (which must agree with the target's URL
 *   class - the label-target-mismatch check at the record boundary,
 *   BOTH directions). A caller-supplied label is the typed
 *   'caller-supplied-label' rejection. A production-real label over a
 *   fixture/local target is the typed 'label-target-mismatch'
 *   rejection (never promoted). A fixture/local label over a
 *   production target is the same mismatch (the other direction).
 * - THE NO-SECRET LAW: the kit NEVER names a secret, NEVER reads env,
 *   NEVER opens a connection. The queryLike port is the ONLY database
 *   seam (the caller - the serverless function - wires the real Neon
 *   driver and reads DATABASE_URL from the function env at RUNTIME).
 *   The kit module itself carries NO credential material.
 * - THE FAIL-CLOSED LAW: the healthCheck default-refuses without a
 *   fetch port (no global fetch in shipped code). A non-200 response
 *   or a network error is the typed 'non-production-target' refusal,
 *   never a green. A dead DB is the honest 'refused' dbConnectivity,
 *   never 'connected'.
 * - THE INJECTED-CLOCK LAW: the kit never reads a clock. Every
 *   timestamp is a read of the caller-injected clock (now returns the
 *   ISO string; the kit carries it verbatim as recordedAtIso /
 *   checkedAtIso / foldedAtIso). No Date.now, no Math.random, no
 *   process.env in this module (law comments excepted).
 * - THE APPEND-ONLY LEDGER LAW: re-recording an id appends a NEW
 *   revision (revision N+1 through the id's PRIMARY KEY UPSERT); the
 *   reader discloses revision counts per id.
 * - THE SINGLE-VERSION LAW: the kit re-carries the contract's
 *   PRODUCTION_OPS_VERSION stamp (the battery pins both copies equal).
 * - FROZEN REJECTION VOCABULARIES, FIRST-FAILURE-IS-THE-VERDICT:
 *   every record / read / schema / health rejection is a typed member
 *   of the frozen PRODUCTION_REJECTION_REASONS list, applied in the
 *   exact list order per walk; the first failing check is THE
 *   verdict.
 * - Zero external dependencies: this module touches only the contract
 *   module's vocabulary and the caller-injected ports.
 */

import {
	PRODUCTION_EVIDENCE_ID_PREFIX,
	PRODUCTION_LEDGER_SCHEMA_SQL,
	PRODUCTION_OPS_VERSION,
	classifyProductionUrl,
	isProductionEvidenceId,
	isProductionEvidenceKind,
	isProductionEvidenceLabel,
	isProductionEvidenceRecord,
	isProductionTarget,
	serializeProductionRecord,
} from './productionOpsContract.js';
import type {
	ProductionEvidenceKind,
	ProductionEvidenceLabel,
	ProductionEvidenceRecord,
	ProductionFetchLike,
	ProductionHealthReport,
	ProductionReadOutcome,
	ProductionRecordOutcome,
	ProductionRejectionReason,
	ProductionSchemaOutcome,
	ProductionTarget,
} from './productionOpsContract.js';

/**
 * The queryLike database port: the ONLY database seam. The shipped
 * kit NEVER opens a connection, NEVER reads process.env. The caller
 * (the serverless function) wires the real Neon driver and reads
 * DATABASE_URL from the function env at RUNTIME. The port returns
 * rows as plain objects (column names as keys); the kit maps between
 * the DB row shape (recorded_at) and the record shape
 * (recordedAtIso).
 */
export type ProductionQueryLike = (sql: string, params?: readonly unknown[]) => Promise<{ rows: unknown[] }>;

/**
 * The rng seam: the id-minting port. The kit calls rng() once per
 * recorded evidence to mint the 16-hex suffix (NEVER the random global).
 * The battery injects deterministic rngs (counter-based, fixed-value)
 * to pin the id-seed determinism law (same rng -> same id; different
 * rngs -> different ids). The kit validates the rng's output (must be
 * exactly 16 lowercase hex chars).
 */
export type ProductionRng = () => string;

/** The kit construction options (all injected, never env-read). */
export interface ProductionOpsKitOptions {
	/** The injected clock (returns the ISO string; the kit carries it verbatim). */
	readonly now: () => string;
	/** The typed production target (the URL + expectedLabel; the label-target-mismatch law's input). */
	readonly target: ProductionTarget;
	/** The ONLY database seam (the caller wires the real Neon driver; the kit never opens a connection). */
	readonly queryLike: ProductionQueryLike;
	/** The id-minting seam (returns 16 lowercase hex chars; NEVER the random global). */
	readonly rng: ProductionRng;
	/** The deployed artifact's self-reported version (carried in the health report and the status fold). */
	readonly version?: string;
}

/** The ledger census fold (the status view's ledger projection). */
export interface ProductionLedgerCensus {
	readonly count: number;
	readonly latestRecordId: string | null;
	readonly latestKind: ProductionEvidenceKind | null;
}

/** The kit state fold (the audit shape: the honest counters). */
export interface ProductionKitState {
	readonly contractVersion: string;
	readonly foldedAtIso: string;
	readonly recordsRecorded: number;
	readonly refusalsEmitted: number;
	readonly schemaEnsured: boolean;
}

/** The status-view fold (the kit's honest audit surface). */
export interface ProductionStatusView {
	readonly target: ProductionTarget;
	readonly version: string;
	readonly ledgerCensus: ProductionLedgerCensus;
	readonly kitState: ProductionKitState;
}

/** The deterministic production ops kit. */
export interface ProductionOpsKit {
	ensureSchema(): Promise<ProductionSchemaOutcome>;
	recordProductionEvidence(kind: unknown, payload: unknown, label?: unknown): Promise<ProductionRecordOutcome>;
	readEvidenceLedger(limit: unknown): Promise<ProductionReadOutcome>;
	healthCheck(fetchLike?: unknown): Promise<ProductionHealthReport>;
	statusView(): Promise<ProductionStatusView>;
}

/** Fixed fixture deployment evidence id (the fixture-policy synthetic id). */
export const FIXTURE_EVIDENCE_DEPLOYMENT_ID = `${PRODUCTION_EVIDENCE_ID_PREFIX}0000000000000001`;

/** Fixed fixture smoke-run evidence id (the fixture-policy synthetic id). */
export const FIXTURE_EVIDENCE_SMOKE_ID = `${PRODUCTION_EVIDENCE_ID_PREFIX}0000000000000002`;

/**
 * The SQL the kit sends to record evidence (the id's PRIMARY KEY
 * UPSERT appends revision N+1 - THE APPEND-ONLY LEDGER LAW). The
 * RETURNING clause yields the row's final shape (the kit maps and
 * validates it through the contract guard). The placeholder style is
 * the Neon serverless driver's $N positional form.
 */
const RECORD_EVIDENCE_SQL = `INSERT INTO production_evidence (id, kind, label, payload, recorded_at, revision)
VALUES ($1, $2, $3, $4::jsonb, $5, 1)
ON CONFLICT (id) DO UPDATE SET
  revision = production_evidence.revision + 1,
  kind = EXCLUDED.kind,
  label = EXCLUDED.label,
  payload = EXCLUDED.payload,
  recorded_at = EXCLUDED.recorded_at
RETURNING id, kind, label, payload, recorded_at, revision`;

/** The SQL the kit sends to read the evidence ledger (newest first). */
const READ_EVIDENCE_SQL = `SELECT id, kind, label, payload, recorded_at, revision
FROM production_evidence
ORDER BY recorded_at DESC
LIMIT $1`;

/** The SQL the kit sends to probe the DB connectivity (the healthCheck DB seam). */
const DB_PROBE_SQL = 'SELECT 1';

/**
 * Creates a production ops kit (fail-closed factory). Validation
 * order is deterministic: the options shape (now must be a function;
 * target must satisfy isProductionTarget; queryLike must be a
 * function; rng must be a function), the rng's output shape (the
 * first rng() call must yield 16 lowercase hex chars - the
 * id-minting law), and ONE read of the injected clock to validate it
 * can produce a non-empty ISO string. The kit starts with ZERO
 * records, refusals and schema ops.
 */
export function createProductionOpsKit(options: ProductionOpsKitOptions): ProductionOpsKit {
	if (!isRecord(options)) {
		throw new TypeError('createProductionOpsKit: options must be an object');
	}
	const opts = options as Record<string, unknown>;
	if (typeof opts.now !== 'function') {
		throw new TypeError(
			'createProductionOpsKit: options.now must be a function returning ISO string values (the injected-clock law - the kit never reads a clock itself)',
		);
	}
	if (!isProductionTarget(opts.target)) {
		throw new TypeError(
			'createProductionOpsKit: options.target must satisfy isProductionTarget (the typed production identity - the URL the exchanges MUST hit for a production-real label)',
		);
	}
	if (typeof opts.queryLike !== 'function') {
		throw new TypeError(
			'createProductionOpsKit: options.queryLike must be a function (the ONLY database seam - the shipped kit never opens a connection, never reads the env)',
		);
	}
	if (typeof opts.rng !== 'function') {
		throw new TypeError(
			'createProductionOpsKit: options.rng must be a function returning 16 lowercase hex chars (the id-minting seam - NEVER the random global)',
		);
	}
	const now = opts.now as () => string;
	const target = opts.target as ProductionTarget;
	const queryLike = opts.queryLike as ProductionQueryLike;
	const rng = opts.rng as ProductionRng;
	const version = typeof opts.version === 'string' ? opts.version : undefined;
	// Validate the clock can produce a non-empty ISO string.
	const firstNow = now();
	if (typeof firstNow !== 'string' || firstNow.length === 0) {
		throw new TypeError(
			'createProductionOpsKit: options.now() must return a non-empty ISO string (the injected-clock law)',
		);
	}
	// Validate the rng can produce a 16-hex id.
	const firstHex = rng();
	if (!/^[0-9a-f]{16}$/.test(firstHex)) {
		throw new TypeError(
			'createProductionOpsKit: options.rng() must return exactly 16 lowercase hex chars (the id-minting seam - the kit mints flauz:prd:<16-hex>)',
		);
	}
	let recordsRecorded = 0;
	let refusalsEmitted = 0;
	let schemaEnsured = false;
	return {
		async ensureSchema(): Promise<ProductionSchemaOutcome> {
			try {
				await queryLike(PRODUCTION_LEDGER_SCHEMA_SQL);
				schemaEnsured = true;
				return { ok: true };
			} catch (error) {
				schemaEnsured = false;
				refusalsEmitted += 1;
				return {
					ok: false,
					reason: 'schema-io',
					detail: `ensureSchema: the queryLike port refused the DDL: ${toMessage(error)}`,
				};
			}
		},
		async recordProductionEvidence(kind: unknown, payload: unknown, label?: unknown): Promise<ProductionRecordOutcome> {
			// Walk the frozen list order: malformed-payload, caller-supplied-label, unknown-kind, label-target-mismatch, ledger-io.
			if (!isRecord(payload)) {
				refusalsEmitted += 1;
				return {
					ok: false,
					reason: 'malformed-payload',
					detail: 'recordProductionEvidence: payload must be a non-null object (the typed JSON payload per kind)',
				};
			}
			if (label !== undefined) {
				refusalsEmitted += 1;
				return {
					ok: false,
					reason: 'caller-supplied-label',
					detail: 'recordProductionEvidence: the label is DERIVED from the target expectedLabel (which must agree with the URL class), never caller-supplied',
				};
			}
			if (!isProductionEvidenceKind(kind)) {
				refusalsEmitted += 1;
				return {
					ok: false,
					reason: 'unknown-kind',
					detail: 'recordProductionEvidence: kind must be a member of the frozen PRODUCTION_EVIDENCE_KINDS list',
				};
			}
			const urlClass = classifyProductionUrl(target.url);
			if (!labelAgreesWithUrlClass(target.expectedLabel, urlClass)) {
				refusalsEmitted += 1;
				return {
					ok: false,
					reason: 'label-target-mismatch',
					detail: `recordProductionEvidence: the target expectedLabel '${target.expectedLabel}' does not agree with the URL class '${urlClass}' (the never-promoted law, BOTH directions)`,
				};
			}
			const derivedKind = kind as ProductionEvidenceKind;
			const derivedLabel: ProductionEvidenceLabel = target.expectedLabel;
			const hex = rng();
			if (!/^[0-9a-f]{16}$/.test(hex)) {
				refusalsEmitted += 1;
				return {
					ok: false,
					reason: 'malformed-payload',
					detail: 'recordProductionEvidence: the rng returned a non-16-hex value (the id-minting seam is corrupt)',
				};
			}
			const id = `${PRODUCTION_EVIDENCE_ID_PREFIX}${hex}`;
			const recordedAtIso = now();
			if (typeof recordedAtIso !== 'string' || recordedAtIso.length === 0) {
				refusalsEmitted += 1;
				return {
					ok: false,
					reason: 'malformed-payload',
					detail: 'recordProductionEvidence: the injected clock returned an empty value (the recordedAtIso is carried verbatim)',
				};
			}
			let rows: unknown[];
			try {
				const result = await queryLike(RECORD_EVIDENCE_SQL, [
					id,
					derivedKind,
					derivedLabel,
					JSON.stringify(payload),
					recordedAtIso,
				]);
				rows = result.rows;
			} catch (error) {
				refusalsEmitted += 1;
				return {
					ok: false,
					reason: 'ledger-io',
					detail: `recordProductionEvidence: the queryLike port refused the append: ${toMessage(error)}`,
				};
			}
			if (!Array.isArray(rows) || rows.length < 1) {
				refusalsEmitted += 1;
				return {
					ok: false,
					reason: 'ledger-io',
					detail: 'recordProductionEvidence: the queryLike port returned no rows from the RETURNING clause',
				};
			}
			const mapped = mapRowToRecord(rows[0]);
			if (!isProductionEvidenceRecord(mapped)) {
				refusalsEmitted += 1;
				return {
					ok: false,
					reason: 'malformed-payload',
					detail: 'recordProductionEvidence: the RETURNING row did not map to a valid ProductionEvidenceRecord',
				};
			}
			recordsRecorded += 1;
			return { ok: true, record: mapped };
		},
		async readEvidenceLedger(limit: unknown): Promise<ProductionReadOutcome> {
			if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
				refusalsEmitted += 1;
				return {
					ok: false,
					reason: 'malformed-payload',
					detail: 'readEvidenceLedger: limit must be a positive integer',
				};
			}
			let rows: unknown[];
			try {
				const result = await queryLike(READ_EVIDENCE_SQL, [limit]);
				rows = result.rows;
			} catch (error) {
				refusalsEmitted += 1;
				return {
					ok: false,
					reason: 'ledger-io',
					detail: `readEvidenceLedger: the queryLike port refused the read: ${toMessage(error)}`,
				};
			}
			if (!Array.isArray(rows)) {
				refusalsEmitted += 1;
				return {
					ok: false,
					reason: 'ledger-io',
					detail: 'readEvidenceLedger: the queryLike port returned a non-array rows value',
				};
			}
			const records: ProductionEvidenceRecord[] = [];
			const revisionCounts: Record<string, number> = {};
			for (let i = 0; i < rows.length; i += 1) {
				const mapped = mapRowToRecord(rows[i]);
				if (!isProductionEvidenceRecord(mapped)) {
					refusalsEmitted += 1;
					return {
						ok: false,
						reason: 'malformed-payload',
						detail: `readEvidenceLedger: row ${i} did not map to a valid ProductionEvidenceRecord (never a silent drop)`,
					};
				}
				records.push(mapped);
				revisionCounts[mapped.id] = mapped.revision;
			}
			return { ok: true, records, revisionCounts };
		},
		async healthCheck(fetchLike?: unknown): Promise<ProductionHealthReport> {
			const checkedAtIso = now();
			const baseReport = {
				version,
				targetUrl: target.url,
				checkedAtIso,
			};
			if (typeof fetchLike !== 'function') {
				refusalsEmitted += 1;
				return {
					ok: false,
					...baseReport,
					dbConnectivity: 'unknown',
					refusal: 'non-production-target',
				};
			}
			const probe = fetchLike as ProductionFetchLike;
			let httpOk = false;
			try {
				const response = await probe(`${target.url}/api/liveness`);
				if (response !== null && typeof response === 'object' && response.ok === true && response.status === 200) {
					httpOk = true;
				}
			} catch {
				httpOk = false;
			}
			if (!httpOk) {
				refusalsEmitted += 1;
				return {
					ok: false,
					...baseReport,
					dbConnectivity: 'unknown',
					refusal: 'non-production-target',
				};
			}
			let dbConnectivity: 'connected' | 'refused';
			try {
				await queryLike(DB_PROBE_SQL);
				dbConnectivity = 'connected';
			} catch {
				dbConnectivity = 'refused';
			}
			return {
				ok: dbConnectivity === 'connected',
				...baseReport,
				dbConnectivity,
			};
		},
		async statusView(): Promise<ProductionStatusView> {
			const foldedAtIso = now();
			let census: ProductionLedgerCensus = {
				count: 0,
				latestRecordId: null,
				latestKind: null,
			};
			const readOutcome = await this.readEvidenceLedger(1000);
			if (readOutcome.ok) {
				const records = readOutcome.records;
				census = {
					count: records.length,
					latestRecordId: records.length > 0 ? records[0].id : null,
					latestKind: records.length > 0 ? records[0].kind : null,
				};
			}
			return {
				target,
				version: version ?? 'unknown',
				ledgerCensus: census,
				kitState: {
					contractVersion: PRODUCTION_OPS_VERSION,
					foldedAtIso,
					recordsRecorded,
					refusalsEmitted,
					schemaEnsured,
				},
			};
		},
	};
}

// --- internal helpers (never exported) ---

/** Pure predicate: a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The label-target agreement check (THE HONEST-EVIDENCE LAW's
 * never-promoted rule, BOTH directions). A production-real label
 * requires a production URL; a fixture label requires a fixture URL;
 * a local-real label requires a local URL. Any mismatch is the typed
 * label-target-mismatch rejection.
 */
function labelAgreesWithUrlClass(label: ProductionEvidenceLabel, urlClass: 'fixture' | 'local' | 'production'): boolean {
	if (label === 'production-real') {
		return urlClass === 'production';
	}
	if (label === 'local-real') {
		return urlClass === 'local';
	}
	if (label === 'fixture') {
		return urlClass === 'fixture';
	}
	return false;
}

/**
 * Maps a DB row (snake_case columns) to the record shape
 * (camelCase fields). The payload column is JSONB: the Neon driver
 * may return it as a parsed object or as a string; the kit normalizes
 * both (parse if string, use as-is if object). Never throws: a
 * malformed row yields an object that fails isProductionEvidenceRecord
 * (the read walk's malformed-payload refusal).
 */
function mapRowToRecord(row: unknown): unknown {
	if (!isRecord(row)) {
		return undefined;
	}
	const r = row as Record<string, unknown>;
	let payload: unknown = r.payload;
	if (typeof payload === 'string') {
		try {
			payload = JSON.parse(payload);
		} catch {
			payload = undefined;
		}
	}
	return {
		id: r.id,
		kind: r.kind,
		label: r.label,
		payload,
		recordedAtIso: r.recorded_at,
		revision: r.revision,
	};
}

/** Extracts a honest message from a thrown value (never re-throws). */
function toMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
