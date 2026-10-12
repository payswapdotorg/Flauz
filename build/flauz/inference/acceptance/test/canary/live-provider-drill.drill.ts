/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-009 LIVE-PROVIDER acceptance drill (the env-activated canary,
 * the repo's real-endpoint drill precedent - see
 * build/flauz/canaries/B-POLICY.md and
 * extensions/flauz-browser/test/canaries/real-chromium-hardening.drill.ts):
 * the INF-009 acceptance kit driven against a REAL provider endpoint
 * over a REAL HTTP exchange - the verification class the fixture
 * battery cannot provide ("the fixture port pins the vocabulary, not
 * the provider's wire"). This is REAL-VERIFICATION code, clearly
 * separated from the gated battery: it is NOT part of the mocha
 * battery (the battery glob is test/common/*.test.ts only) and it
 * never fails a gate for lacking a provider.
 *
 * ENV CONTRACT (the station's activation surface - the ONLY sanctioned
 * process.env reader in this family's tree; the family code under
 * common/** never reads env, never opens a socket, never names a
 * secret):
 *   FLAUZ_LIVE_PROVIDER_URL        - the real provider endpoint the
 *                                    live port exchanges with;
 *   FLAUZ_LIVE_PROVIDER_KEY_HANDLE - the station-supplied opaque
 *                                    credential HANDLE REFERENCE the
 *                                    drill binds (the typed reference
 *                                    only - safe-to-persist by
 *                                    contract; the raw secret, if the
 *                                    endpoint needs one, stays inside
 *                                    the station's endpoint contract,
 *                                    never in this file, never in any
 *                                    record the kit writes).
 *
 * The station sets the env contract ONLY for a provider whose terms
 * it has verified PERMITTED for this drill (the FRESH-CHAT-TL-B
 * handoff law: verify the current upstream license and every
 * provider's current terms before enabling any live source) - the
 * canary's catalog entry declares exactly that station-side verdict.
 *
 * SKIP semantics (never fail a gate for lacking a provider):
 *   - either env var unset        -> SKIP: no env contract
 *   - endpoint unreachable (5s probe) -> SKIP: endpoint unreachable
 *   Exit 0 on SKIP. Exit 1 ONLY when a REACHABLE provider exchange
 *   violates the acceptance kit's own honest-evidence laws (a label
 *   that is not 'live-real', an unexchanged drill, a missing ledger
 *   line, a guard rejection) - that is the drift-canary property.
 *
 * WHAT IT DRIVES (REAL code only): createAcceptanceKit over
 * canary-bound records (the env endpoint and handle bound through the
 * landed admit* guards), the live network port whose fetchLike
 * performs the REAL HTTP exchange (POST the typed wire request to the
 * real endpoint, the handle reference forwarded as the exchange
 * credential), and the kit's own folds - the eligibility fold, the
 * exchange, the landed report/disclosure/presentation projections,
 * the canonical drill-evidence bytes, the append-only ledger.
 *
 * WHAT IT ASSERTS, each with REAL observed evidence:
 *   1. the acceptance drill over the live port derives the evidence
 *      label 'live-real' (THE UPGRADE LAW on real evidence - claimed
 *      only when a live exchange actually happened);
 *   2. a completed exchange yields a DrillRecord that satisfies the
 *      contract guard and lands one canonical ledger line; a REFUSED
 *      exchange (any non-2xx real response, mapped verbatim to the
 *      refused side) yields live-real FailureEvidence with the real
 *      provider's refusal reason VERBATIM (THE HONEST-FAILURE LAW -
 *      never retried into success, never converted to fixture);
 *   3. the ledger line reads back through the SAME live kit and
 *      projects;
 *   4. THE NO-LIVE-PORT LAW at the read boundary: the SAME ledger
 *      line read through a fixture-configured kit is the typed
 *      'no-live-port' rejection - live-real never promotes.
 *
 * The canary reads the REAL clock (Date.now) for the injected clock
 * and the observation timestamps - REAL-VERIFICATION code is
 * sanctioned to; the family code under common/** stays
 * deterministic (the battery greps pin it).
 *
 * Exit codes: 0 = drill green (or SKIP); 1 = an honest-evidence law
 * was violated on a reachable provider (or the canary's own wiring
 * failed - a typed drill refusal on a reachable endpoint).
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	ACCEPTANCE_DRILLS_LEDGER_FILE,
	FIXTURE_ACCEPTANCE_HEALTHY_ID,
	createAcceptanceKit,
} from '../../common/acceptanceKit.js';
import type { AcceptanceKit } from '../../common/acceptanceKit.js';
import {
	isDrillRecord,
	isFailureEvidence,
	serializeAcceptanceRecord,
} from '../../common/acceptanceContract.js';
import type { DrillRecord, FailureEvidence } from '../../common/acceptanceContract.js';
import { unknownCapacityEntry } from '../../../catalog/common/providerCatalog.js';
import type { AdapterObservation } from '../../../adapters/common/providerAdapter.js';

const LIVE_URL = process.env['FLAUZ_LIVE_PROVIDER_URL'] ?? '';
const KEY_HANDLE = process.env['FLAUZ_LIVE_PROVIDER_KEY_HANDLE'] ?? '';
const PROBE_TIMEOUT_MS = 5000;
const EXCHANGE_TIMEOUT_MS = 15_000;
const CANARY_CATALOG_ID = 'canary.catalog.live-provider';
const CANARY_ADAPTER_SET_ID = 'canary.adapter-set.live-provider';
const CANARY_SCOPE_SET_ID = 'canary.scope-set.live-provider';
const CANARY_PROVIDER = 'canary.provider.live';
const CANARY_SCOPE_ID = 'canary.scope.live';
const CANARY_MODEL = 'canary.model.live-probe';
const CANARY_DRILL_ID = 'canary.drill.live-provider-1';
const CANARY_ROOT = join(tmpdir(), 'flauz-inference-acceptance-canary');
const CANARY_FIXTURE_ROOT = join(tmpdir(), 'flauz-inference-acceptance-canary-fixture');
const INFERENCE_CATALOG_STAMP = '1.0.0';
const INFERENCE_ADAPTER_STAMP = '1.0.0';
const INFERENCE_ISOLATION_STAMP = '1.0.0';

/** The canary-bound records: the env endpoint and handle bound through the landed shapes. */
function canaryBoundRecords(): {
	catalog: Record<string, unknown>;
	adapters: Record<string, unknown>;
	scopes: Record<string, unknown>;
} {
	const now = Date.now();
	return {
		catalog: {
			catalogId: CANARY_CATALOG_ID,
			entries: [
				{
					// The station-side declaration: the env contract is set only
					// for a provider whose terms the station verified PERMITTED.
					...unknownCapacityEntry(CANARY_PROVIDER, 'third-party-free-tier', now),
					termsState: 'permitted',
				},
			],
			contractVersion: INFERENCE_CATALOG_STAMP,
		},
		adapters: {
			adapterSetId: CANARY_ADAPTER_SET_ID,
			adapters: [
				{
					adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID,
					displayName: 'Canary Live Provider Adapter',
					providerEntryId: CANARY_PROVIDER,
					transportKind: 'http-generic-json',
					capacityProvenance: 'third-party-free-tier',
					credentialHandle: KEY_HANDLE,
					contractVersion: INFERENCE_ADAPTER_STAMP,
				},
			],
			contractVersion: INFERENCE_ADAPTER_STAMP,
		},
		scopes: {
			scopeSetId: CANARY_SCOPE_SET_ID,
			scopes: [
				{ id: CANARY_SCOPE_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: KEY_HANDLE },
			],
			contractVersion: INFERENCE_ISOLATION_STAMP,
		},
	};
}

/**
 * The REAL exchange: POST the typed wire request to the real endpoint,
 * the handle reference forwarded as the exchange credential. The
 * response maps honestly to the typed wire response: a 2xx completes
 * with the minimal honest observation (healthy on the real 2xx; the
 * capacity fields the endpoint did not disclose stay the honest
 * unknown states, never fabricated); ANY non-2xx is the refused side
 * with the real provider's reason VERBATIM; a network error is caught
 * HERE and carried on the refused side (the port itself carries the
 * honest failure - never a thrown seam).
 */
async function realExchange(endpoint: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${KEY_HANDLE}`,
			},
			body: JSON.stringify(request),
			signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
		});
		if (!response.ok) {
			return {
				completed: false,
				refusalReason: `HTTP ${String(response.status)} ${response.statusText}: refused by the real provider endpoint`,
			};
		}
		const observation: AdapterObservation = {
			observedAtEpochMs: Date.now(),
			health: 'healthy',
			quota: { state: 'unknown' },
			cooldown: { state: 'none' },
			reset: { kind: 'unknown' },
		};
		return { completed: true, observation };
	} catch (error) {
		return {
			completed: false,
			refusalReason: `network error: ${(error as Error).message}`,
		};
	}
}

function freshRoot(root: string): string {
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	return root;
}

function fail(message: string): never {
	console.error(`LIVE-PROVIDER drill: FAIL: ${message}`);
	process.exit(1);
}

async function main(): Promise<void> {
	if (LIVE_URL === '' || KEY_HANDLE === '') {
		console.log('SKIP: no FLAUZ_LIVE_PROVIDER_URL / FLAUZ_LIVE_PROVIDER_KEY_HANDLE (the env contract is unset - the live-provider drill never fails a gate for lacking a provider)');
		return;
	}

	// --- reachability probe (never fail a gate for an unreachable endpoint) ---
	let probeStatus = '';
	try {
		const probe = await fetch(LIVE_URL, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${KEY_HANDLE}`,
			},
			body: JSON.stringify({ kind: 'canary-probe' }),
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		probeStatus = `${String(probe.status)} ${probe.statusText}`;
		await probe.text();
	} catch {
		console.log(`SKIP: FLAUZ_LIVE_PROVIDER_URL unreachable (${LIVE_URL}) - the live-provider drill never fails a gate for an unreachable endpoint`);
		return;
	}

	const bound = canaryBoundRecords();
	const liveRoot = freshRoot(CANARY_ROOT);
	const livePort = {
		kind: 'live',
		endpoint: LIVE_URL,
		fetchLike: realExchange,
	};
	const credentialPort = {
		kind: 'handle',
		scope: { id: CANARY_SCOPE_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: KEY_HANDLE },
		resolve: async () => ({
			resolved: true,
			scopeId: CANARY_SCOPE_ID,
			adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID,
			credentialHandle: KEY_HANDLE,
		}),
	};
	const liveKit: AcceptanceKit = createAcceptanceKit({
		now: () => Date.now(),
		catalog: bound.catalog,
		adapters: bound.adapters,
		scopes: bound.scopes,
		networkPort: livePort,
		credentialPort,
		ledgerRoot: liveRoot,
	});

	console.log(`LIVE-PROVIDER drill: endpoint '${LIVE_URL}' reachable (probe: ${probeStatus}) - drilling the real exchange`);
	const outcome = await liveKit.runAcceptanceDrill({
		drillId: CANARY_DRILL_ID,
		requestedModelId: CANARY_MODEL,
	});

	// --- assertion 1: the drill exchanged (a typed refusal on a reachable endpoint is a wiring bug) ---
	if (!outcome.drilled) {
		fail(`the acceptance drill refused instead of exchanging: '${outcome.reason}': ${outcome.detail}`);
	}

	// --- assertion 2: THE UPGRADE LAW on real evidence - the label is 'live-real' ---
	if (outcome.evidence.evidenceLabel !== 'live-real') {
		fail(`the live exchange derived the evidence label '${outcome.evidence.evidenceLabel}' - a real network exchange must derive 'live-real' (the upgrade law)`);
	}

	let completedRecord: DrillRecord | undefined;
	let failureEvidence: FailureEvidence | undefined;
	if (outcome.evidence.kind === 'drill') {
		completedRecord = outcome.evidence;
		if (!isDrillRecord(completedRecord)) {
			fail('the completed live-real drill record does not satisfy isDrillRecord (the drift fail-closed law)');
		}
		console.log(`LIVE-PROVIDER drill: COMPLETED exchange recorded as live-real DrillRecord (drillClass '${completedRecord.drillClass}', verdict '${completedRecord.payload.eligibilityVerdict}', ${String(completedRecord.byteCitations.length)} landed byte citations)`);
	} else {
		failureEvidence = outcome.evidence;
		if (!isFailureEvidence(failureEvidence)) {
			fail('the refused live exchange did not record honest FailureEvidence (the drift fail-closed law)');
		}
		// THE HONEST-FAILURE LAW: the real provider's refusal reason rides VERBATIM.
		console.log(`LIVE-PROVIDER drill: REFUSED exchange recorded as live-real FailureEvidence (drillClass '${failureEvidence.drillClass}', failure reason verbatim: '${failureEvidence.failureReason}') - never retried into success, never converted to fixture`);
	}

	// --- assertion 3: the ledger line landed and reads back through the SAME live kit ---
	const ledgerPath = join(liveRoot, ACCEPTANCE_DRILLS_LEDGER_FILE);
	const lines = readFileSync(ledgerPath, 'utf8').split('\n').filter((line) => line.length > 0);
	if (lines.length !== 1) {
		fail(`the drill ledger carries ${String(lines.length)} line(s) after one drill - expected exactly one canonical line`);
	}
	const readBack = liveKit.readDrillLedger(ledgerPath, 1);
	if (!readBack.projected) {
		fail(`the live kit's own ledger line does not project back: '${readBack.reason}': ${readBack.detail}`);
	}
	if (readBack.view.canonicalBytes !== lines[0]) {
		fail('the read-back canonical bytes differ from the ledger line bytes (the canonical bytes law)');
	}
	console.log('LIVE-PROVIDER drill: the canonical ledger line reads back through the live kit and projects (byte-identical)');

	// --- assertion 4: THE NO-LIVE-PORT LAW at the read boundary (live-real never promotes) ---
	const fixtureRoot = freshRoot(CANARY_FIXTURE_ROOT);
	const fixtureKit: AcceptanceKit = createAcceptanceKit({
		now: () => Date.now(),
		catalog: bound.catalog,
		adapters: bound.adapters,
		scopes: bound.scopes,
		networkPort: {
			kind: 'fixture',
			respond: () => ({ completed: true, observation: { observedAtEpochMs: Date.now(), health: 'healthy', quota: { state: 'unknown' }, cooldown: { state: 'none' }, reset: { kind: 'unknown' } } }),
		},
		ledgerRoot: fixtureRoot,
	});
	const fixtureRead = fixtureKit.readDrillLedger(ledgerPath, 1);
	if (fixtureRead.projected || fixtureRead.reason !== 'no-live-port') {
		fail(`the fixture-configured kit must refuse the live-real ledger line with the typed 'no-live-port' rejection (the upgrade law at the read boundary), got: ${JSON.stringify(fixtureRead).slice(0, 300)}`);
	}
	console.log("LIVE-PROVIDER drill: the SAME ledger line over a fixture-configured port is the typed 'no-live-port' rejection - live-real is claimed ONLY when a live exchange actually happened, never promoted");

	// --- the honest-evidence receipts ---
	const evidenceBytes = serializeAcceptanceRecord(completedRecord ?? failureEvidence);
	console.log(`LIVE-PROVIDER drill: canonical evidence bytes (${String(evidenceBytes.length)} chars) land in ${ACCEPTANCE_DRILLS_LEDGER_FILE} under the caller-injected root (outside the repo tree)`);
	if (completedRecord !== undefined) {
		console.log('LIVE-PROVIDER drill: GREEN (real exchange through the acceptance kit: live-real DrillRecord, canonical ledger bytes, read-back projection, the no-live-port boundary law)');
	} else {
		console.log('LIVE-PROVIDER drill: GREEN (real refused exchange through the acceptance kit: live-real FailureEvidence with the provider reason verbatim, canonical ledger bytes, read-back projection, the no-live-port boundary law)');
	}
}

void main().catch((error: unknown) => {
	console.error('LIVE-PROVIDER drill: ERROR', error);
	process.exit(1);
});
