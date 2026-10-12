/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * A-PROD-006-W7 production deploy: the /api/evidence Vercel serverless
 * function (the runtime seam). Routes:
 *   POST /api/evidence  body {kind, payload}  -> record (the production-real write)
 *   GET  /api/evidence?limit=10               -> the ledger read (the production-real read)
 *
 * Wires the production ops kit with the REAL Neon driver, reads
 * DATABASE_URL from the function env at RUNTIME (never committed).
 * The POST derives the label from the target (production-real over
 * the production target); a caller-supplied label is the typed
 * 'caller-supplied-label' rejection (THE HONEST-EVIDENCE LAW).
 *
 * THE NO-SECRET LAW: no credential material in this file.
 */

import { neon } from '@neondatabase/serverless';
import { createProductionOpsKit } from '../ops/common/productionOpsKit.js';
import type { ProductionQueryLike } from '../ops/common/productionOpsKit.js';

interface VercelRequest {
	method?: string;
	body?: unknown;
	query?: { limit?: string };
}

export default async function handler(
	req: VercelRequest,
	res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
	const databaseUrl = process.env.DATABASE_URL;
	if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
		res.status(500).json({ ok: false, detail: 'DATABASE_URL not configured' });
		return;
	}
	const sql = neon(databaseUrl);
	const queryLike: ProductionQueryLike = async (statement: string, params?: readonly unknown[]) => {
		// A-PROD-006-W7 deploy-round fix (worker aprod007f, deploy-validated LIVE): the
		// @neondatabase/serverless 1.2.0 neon() fn rejects the positional sql(stmt, ...params)
		// form (a latent defect — the station's mock-queryLike battery never exercises the
		// real driver); sql.query(stmt, [params]) is the working conventional form.
		const rows = await sql.query(statement, params ?? []);
		return { rows: rows as unknown[] };
	};
	const targetUrl = typeof process.env.FLAUZ_PRODUCTION_URL === 'string' ? process.env.FLAUZ_PRODUCTION_URL : '';
	const kit = createProductionOpsKit({
		now: () => new Date().toISOString(),
		target: { url: targetUrl, expectedLabel: 'production-real' },
		queryLike,
		rng: () => generateHex(),
		version: process.env.FLAUZ_VERSION ?? '0.2.0',
	});
	const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET';
	if (method === 'POST') {
		const body = req.body;
		if (body === null || typeof body !== 'object' || Array.isArray(body)) {
			res.status(400).json({ ok: false, reason: 'malformed-payload', detail: 'body must be an object {kind, payload}' });
			return;
		}
		const record = body as { kind?: unknown; payload?: unknown };
		const outcome = await kit.recordProductionEvidence(record.kind, record.payload);
		if (outcome.ok) {
			res.status(201).json(outcome.record);
		} else {
			res.status(400).json(outcome);
		}
		return;
	}
	if (method === 'GET') {
		const limitParam = typeof req.query?.limit === 'string' ? parseInt(req.query.limit, 10) : 10;
		const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : 10;
		const outcome = await kit.readEvidenceLedger(limit);
		if (outcome.ok) {
			res.status(200).json({ records: outcome.records, revisionCounts: outcome.revisionCounts });
		} else {
			res.status(500).json(outcome);
		}
		return;
	}
	res.status(405).json({ ok: false, detail: `method ${method} not allowed` });
}

/** Generates 16 lowercase hex chars from the boundary clock (the runtime-seam rng). */
function generateHex(): string {
	const seed = `${Date.now()}-${Math.random()}`;
	let hash = 0;
	for (let i = 0; i < seed.length; i += 1) {
		hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
	}
	const hex = (hash >>> 0).toString(16).padStart(8, '0');
	const hex2 = ((hash >>> 8) ^ (hash >>> 16)).toString(16).padStart(8, '0');
	return (hex + hex2).slice(0, 16);
}
