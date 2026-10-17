/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * A-PROD-006-W7 production deploy: the GET /api/status Vercel
 * serverless function (the runtime seam). Wires the production ops
 * kit with the REAL Neon driver, reads DATABASE_URL from the function
 * env at RUNTIME (never committed), and returns the kit's statusView
 * fold (the target, the version, the ledger census, the kit state).
 *
 * THE NO-SECRET LAW: no credential material in this file. The
 * DATABASE_URL is read from process.env at RUNTIME only.
 */

import { neon } from '@neondatabase/serverless';
import { createProductionOpsKit } from '../ops/common/productionOpsKit.js';
import type { ProductionQueryLike } from '../ops/common/productionOpsKit.js';

export default async function handler(
	_req: unknown,
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
		version: process.env.FLAUZ_VERSION ?? '0.2.1',
	});
	const view = await kit.statusView();
	res.status(200).json(view);
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
