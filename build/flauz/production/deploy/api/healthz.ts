/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * A-PROD-006-W7 production deploy: the GET /api/healthz Vercel
 * serverless function (the runtime seam). Wires the production ops
 * kit with the REAL Neon driver (@neondatabase/serverless - installed
 * in the DEPLOY workspace only, never in the repo tree), reads
 * DATABASE_URL from the function env at RUNTIME (never committed),
 * and constructs `now` at the boundary (the determinism disclosure
 * row: the shipped contract+kit are deterministic; this runtime seam
 * is the sanctioned clock-read point).
 *
 * THE NO-SECRET LAW: no credential material in this file. The
 * DATABASE_URL is read from process.env at RUNTIME and passed to the
 * Neon driver; the kit never sees it, never names it.
 *
 * THE FAIL-CLOSED LAW: a dead DB is the honest 'refused'
 * dbConnectivity, never a green 'connected'. The function returns the
 * kit's health report verbatim (the kit's fail-closed probe).
 */

import { neon } from '@neondatabase/serverless';
import { createProductionOpsKit } from '../ops/common/productionOpsKit.js';
import type { ProductionQueryLike } from '../ops/common/productionOpsKit.js';
import type { ProductionHealthReport } from '../ops/common/productionOpsContract.js';

export default async function handler(
	_req: unknown,
	res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
	const databaseUrl = process.env.DATABASE_URL;
	if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
		res.status(500).json({
			ok: false,
			targetUrl: process.env.FLAUZ_PRODUCTION_URL ?? '',
			checkedAtIso: new Date().toISOString(),
			dbConnectivity: 'unknown',
			refusal: 'non-production-target',
		} satisfies ProductionHealthReport);
		return;
	}
	const sql = neon(databaseUrl);
	const queryLike: ProductionQueryLike = async (statement: string, params?: readonly unknown[]) => {
		if (params !== undefined && params.length > 0) {
			const rows = await sql(statement, ...params);
			return { rows: rows as unknown[] };
		}
		const rows = await sql(statement);
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
	// The healthCheck self-probes: the fetchLike proves the app is up
	// (the function is executing); the kit probes the DB via queryLike.
	const report = await kit.healthCheck(async () => ({ ok: true, status: 200 }));
	res.status(report.ok ? 200 : 503).json(report);
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
