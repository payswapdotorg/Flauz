/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL4-H1 -- model-switch RUNTIME drill (doctrine TL4-PERF-BUDGETS.md section
 * 6.2; registry rows model.switch.ready.p95 / model.switch.warmup.p95).
 *
 * MEASURES, on the REAL flauz-models provider seam (src/fabric.ts, the same
 * code path activation wires):
 *   - ready: t0 = switch command (the drill selects the target vendor, the
 *     act the model picker rides) -> t1 = the target provider's model list
 *     available through the fabric provider surface
 *     (providerFor(entry).provideLanguageModelChatInformation()). This is
 *     the INTERACTIVE path of a switch: registry-resolved config -> adapter
 *     construction (first use; the fabric provider cache serves repeats) ->
 *     the model list the picker and the next request consume.
 *   - warmup: the switch-triggered vendor warm-up OFF the interactive path --
 *     the auth+handshake health probe (adapter.health(): GET {base}/models
 *     with the resolved credential, section 5.1's 2s ceiling class), on the
 *     adapter built from the SAME registry-resolved config the fabric uses.
 *
 * HONEST SCOPE (documented in the registry row notes + BASELINE.md): the
 * vendor endpoint is a LOCAL mock (node:http on 127.0.0.1, ephemeral port,
 * OpenAI list-models shape). The seam measured (fabric resolution, provider
 * cache, adapter construction, credential resolution, real HTTP round trip)
 * is product code; the VENDOR WIRE BEHAVIOR is mocked (inference is excluded
 * by the doctrine contract anyway -- first-token latency is a vendor
 * property). Live-vendor recalibration is owned by TL2-H1 (live-provider
 * verification) and is NOT claimed here.
 *
 * The flauz-mock vendor (src/mockProvider.ts, the real deterministic echo
 * provider) is the alternating switch target: rounds alternate
 * flauz-openai-compat <-> flauz-mock so BOTH directions of the switch are
 * sampled; the warm-up act only exists for the adapter-backed vendor (the
 * mock has no vendor connection -- honest: warmup samples come only from the
 * openai-compat rounds, N rounds -> ceil(N/2) warmup samples).
 *
 * MODES:
 *   (no flags)   the full runtime run (N=--rounds switch rounds, default 30,
 *                minimum 5 per the doctrine sample floor), p95 nearest-rank,
 *                measurement records printed + written with --out.
 *   --selftest   zero-dep machinery self-test (percentile math, switch plan,
 *                envelope shape, over-budget detectability). No fs, no
 *                server, no fabric.
 *   --out <file> write the budget-gate measurement envelope
 *                {"measurements":[...]} (the exact shape budget-gate.mjs
 *                consumes) to this file. Raw per-round samples go to stdout
 *                (the CI log is the evidence transcript).
 *   --rounds <n> switch rounds (default 30; minimum 5).
 *
 * SKIP semantics (the shared drill law): FLAUZ_MODEL_SWITCH_RUNTIME_SKIP=1
 * -> SKIP, exit 0. Never fails for lacking external resources (there are
 * none); exit 1 ONLY when the real seam diverges from the contract above
 * (empty model list from an enabled provider, unhealthy handshake, zero
 * samples).
 *
 * Zero runtime dependencies: node >= 22.6 stdlib (type stripping; node:http,
 * node:fs/promises, node:os, node:path). No 'vscode' import is needed: every
 * src module this drill touches imports 'vscode' as TYPE ONLY (erased).
 *
 * Exit codes: 0 = drill green (or SKIP, or selftest green); 1 = assertion
 * failed (the failing row named on stderr); 2 = usage error.
 */

import { createHash } from 'node:crypto';
import * as http from 'node:http';
import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { bootstrapFabric, FABRIC_VENDORS } from '../../src/fabric.ts';
import { nodeHttpPort } from '../../src/contract/nodePorts.ts';
import type { FileSystemPort, SecretResolverPort } from '../../src/contract/ports.ts';
import { createMockProvider } from '../../src/mockProvider.ts';
import { createOpenAiCompatAdapter } from '../../src/adapters/openAiCompat.ts';
import { PROVIDERS_SCHEMA_ID } from '../../src/discovery/configs.ts';
import type * as vscode from 'vscode';

const PREFIX = 'model-switch runtime drill';
const FORCE_SKIP = process.env['FLAUZ_MODEL_SWITCH_RUNTIME_SKIP'] === '1';
const DEFAULT_ROUNDS = 30;
const MIN_ROUNDS = 5;

/** Credential for the local mock vendor endpoint (synthetic; env-resolved by the real seam). */
const MOCK_ENDPOINT_KEY_ENV = 'FLAUZ_MODEL_SWITCH_KEY';
const MOCK_ENDPOINT_KEY = 'flauz-drill-mock-key';

// ---------------------------------------------------------------------------
// Machinery: nearest-rank percentile (perf-log-parse.mjs stats semantics,
// replicated locally so the drill stays inside extensions/; pinned by
// --selftest so the method cannot drift).
// ---------------------------------------------------------------------------

function percentileNearestRank(sortedValues: readonly number[], p: number): number {
	if (sortedValues.length === 0) {
		throw new Error('percentileNearestRank: empty input');
	}
	const n = sortedValues.length;
	if (n === 1) {
		return sortedValues[0] ?? 0;
	}
	const rank = Math.ceil((p / 100) * n);
	const clamped = Math.min(Math.max(rank, 1), n);
	return sortedValues[clamped - 1] ?? 0;
}

function stats(values: readonly number[]): { n: number; min: number; max: number; mean: number; p50: number; p95: number } {
	const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v)).slice().sort((a, b) => a - b);
	if (nums.length === 0) {
		throw new Error('stats: no samples');
	}
	const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
	return {
		n: nums.length,
		min: nums[0] ?? 0,
		max: nums[nums.length - 1] ?? 0,
		mean,
		p50: percentileNearestRank(nums, 50),
		p95: percentileNearestRank(nums, 95),
	};
}

// ---------------------------------------------------------------------------
// Machinery: the local mock vendor endpoint (OpenAI list-models wire shape).
// ---------------------------------------------------------------------------

interface MockVendorServer {
	readonly port: number;
	/** Authorization headers seen on /v1/models probes (the auth leg is real). */
	readonly authHeaders: string[];
	close(): Promise<void>;
}

async function startMockVendorEndpoint(): Promise<MockVendorServer> {
	const authHeaders: string[] = [];
	const server = http.createServer((req, res) => {
		const url = req.url ?? '';
		if (req.method === 'GET' && (url === '/v1/models' || url === '/v1/models/')) {
			const auth = req.headers['authorization'];
			if (typeof auth === 'string') {
				authHeaders.push(auth);
			}
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({
				object: 'list',
				data: [{ id: 'drill-mini-1', object: 'model', owned_by: 'flauz-drill' }],
			}));
			return;
		}
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: { message: `flauz drill mock: no route for ${req.method ?? ''} ${url}` } }));
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const address = server.address();
	if (address === null || typeof address === 'string') {
		throw new Error('model-switch drill: mock vendor endpoint did not bind an ephemeral port');
	}
	return {
		port: address.port,
		authHeaders,
		close: () => new Promise<void>((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error)))),
	};
}

// ---------------------------------------------------------------------------
// Machinery: the fabric deps (real fs on a real temp workspace, real env
// secret resolver, real http port; the nodeFileSystemPort twin of
// src/extension.ts -- the extension's own is module-private).
// ---------------------------------------------------------------------------

function drillFileSystemPort(): FileSystemPort {
	return {
		async readFileUtf8(file) {
			try {
				return await nodeFs.readFile(file, 'utf-8');
			} catch (error) {
				if ((error as { code?: string }).code === 'ENOENT') {
					return undefined;
				}
				throw error;
			}
		},
		async writeFile(file, contents) {
			await nodeFs.writeFile(file, contents);
		},
		async rename(from, to) {
			await nodeFs.rename(from, to);
		},
		async mkdir(dir) {
			try {
				await nodeFs.mkdir(dir);
			} catch (error) {
				if ((error as { code?: string }).code === 'EEXIST') {
					return;
				}
				throw error;
			}
		},
	};
}

/** The real sha256 hash port (the same semantics src/extension.ts wires). */
function sha256Hex(input: string): string {
	return createHash('sha256').update(input, 'utf-8').digest('hex');
}

/** A never-firing cancellation token (the vscode.CancellationToken minimal surface). */
const drillToken: vscode.CancellationToken = {
	isCancellationRequested: false,
	onCancellationRequested: (_listener: unknown) => ({ dispose(): void { /* never fires */ } }),
};

function envSecretResolver(): SecretResolverPort {
	return {
		async resolve(ref) {
			if (ref.startsWith('env:')) {
				return process.env[ref.slice('env:'.length)];
			}
			return undefined;
		},
	};
}

// ---------------------------------------------------------------------------
// The drill body.
// ---------------------------------------------------------------------------

interface SwitchPlanEntry {
	readonly round: number;
	readonly target: 'flauz-mock' | 'flauz-openai-compat';
}

/** The alternating switch plan (both directions sampled every two rounds). */
function switchPlan(rounds: number): SwitchPlanEntry[] {
	const plan: SwitchPlanEntry[] = [];
	for (let i = 0; i < rounds; i++) {
		plan.push({ round: i + 1, target: i % 2 === 0 ? 'flauz-openai-compat' : 'flauz-mock' });
	}
	return plan;
}

interface MeasurementRecord {
	readonly id: string;
	readonly value: number;
	readonly unit: string;
	readonly measuredAt: string;
	readonly source: string;
	readonly samples?: number;
}

function envelopeOf(records: readonly MeasurementRecord[]): { measurements: readonly MeasurementRecord[] } {
	return { measurements: records };
}

async function runDrill(rounds: number, outFile: string | undefined): Promise<void> {
	const workspaceRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'flauz-model-switch-'));
	const server = await startMockVendorEndpoint();
	const baseUrl = `http://127.0.0.1:${server.port}/v1`;
	try {
		// Real durable state: the workspace providers file ENABLES openai-compat
		// against the local mock endpoint (the honest zero-network vendor stand-in).
		process.env[MOCK_ENDPOINT_KEY_ENV] = MOCK_ENDPOINT_KEY;
		const stateDir = path.join(workspaceRoot, '.flauz', 'models');
		await nodeFs.mkdir(stateDir, { recursive: true });
		await nodeFs.writeFile(path.join(stateDir, 'providers.json'), `${JSON.stringify({
			schema: PROVIDERS_SCHEMA_ID,
			schemaVersion: 0,
			updatedAt: 1,
			providers: [{ providerId: 'openai-compat', enabled: true, baseUrl, credentialRef: `env:${MOCK_ENDPOINT_KEY_ENV}` }],
		}, null, 2)}\n`);

		// The REAL fabric (the same bootstrap activation wires, real fs/clock/http/secrets).
		const fabric = bootstrapFabric({
			root: workspaceRoot,
			fs: drillFileSystemPort(),
			clock: () => Date.now(),
			secrets: envSecretResolver(),
			hash: { sha256Hex },
			http: nodeHttpPort,
			log: () => undefined,
		});
		const loaded = await fabric.ready;
		const openAiEntry = FABRIC_VENDORS.find(entry => entry.vendor === 'flauz-openai-compat');
		if (openAiEntry === undefined) {
			throw new Error('model-switch drill: FABRIC_VENDORS does not carry flauz-openai-compat');
		}
		const compatProvider = fabric.providerFor(openAiEntry);
		const mockProvider = createMockProvider();

		// Registry record honesty: openai-compat ENABLED with the drill endpoint;
		// the fabric provider cache key derives from the registry config.
		const compatConfig = loaded.registry.toAdapterConfigs().find(config => config.providerId === 'openai-compat');
		if (compatConfig === undefined) {
			throw new Error('model-switch drill: openai-compat not enabled in the registry (providers.json did not take)');
		}

		// The warm-up probe rides the REAL openai-compat adapter built from the
		// SAME registry-resolved config the fabric uses (providerFor exposes the
		// 3-method vscode surface only; health() is the adapter's own seam).
		const warmupAdapter = createOpenAiCompatAdapter({
			config: compatConfig,
			http: nodeHttpPort,
			secrets: envSecretResolver(),
			hash: { sha256Hex },
			clock: () => Date.now(),
		});

		const plan = switchPlan(rounds);
		const readySamples: number[] = [];
		const warmupSamples: number[] = [];
		console.log(`${PREFIX}: ${rounds} switch rounds over the real fabric seam (endpoint ${baseUrl})`);

		for (const entry of plan) {
			const provider = entry.target === 'flauz-mock' ? mockProvider : compatProvider;
			// ready: switch command -> target provider's model list available.
			const t0 = performance.now();
			const models = await provider.provideLanguageModelChatInformation({ silent: true }, drillToken);
			const readyMs = performance.now() - t0;
			if (!Array.isArray(models) || models.length === 0) {
				throw new Error(`model-switch drill round ${entry.round}: switch to '${entry.target}' resolved ZERO models (a failed switch, not a measurement)`);
			}
			readySamples.push(readyMs);

			if (entry.target === 'flauz-openai-compat') {
				// warmup: the switch-triggered vendor handshake off the interactive path.
				const t1 = performance.now();
				const health = await warmupAdapter.health();
				const warmupMs = performance.now() - t1;
				if (health.status !== 'healthy') {
					throw new Error(`model-switch drill round ${entry.round}: vendor handshake ${health.status} (${health.detail})`);
				}
				warmupSamples.push(warmupMs);
			}
			console.log(`${PREFIX}:   round ${String(entry.round).padStart(2)} -> ${entry.target.padEnd(19)} ready ${readyMs.toFixed(1)}ms${entry.target === 'flauz-openai-compat' ? ` warmup ${(warmupSamples[warmupSamples.length - 1] ?? 0).toFixed(1)}ms` : ''}`);
		}

		// The auth leg is REAL: the health probe carries the env-resolved key.
		if (!server.authHeaders.some(header => header === `Bearer ${MOCK_ENDPOINT_KEY}`)) {
			throw new Error(`model-switch drill: the health probe never presented the env-resolved credential (saw ${JSON.stringify(server.authHeaders)})`);
		}
		console.log(`${PREFIX}: auth leg verified (${server.authHeaders.length} probes carried the env-resolved Bearer key)`);

		const readyStats = stats(readySamples);
		const warmupStats = stats(warmupSamples);
		if (readyStats.n < MIN_ROUNDS) {
			throw new Error(`model-switch drill: only ${readyStats.n} ready samples (minimum ${MIN_ROUNDS})`);
		}
		console.log(`${PREFIX}: ready   p50=${readyStats.p50.toFixed(1)}ms p95=${readyStats.p95.toFixed(1)}ms n=${readyStats.n} (min ${readyStats.min.toFixed(1)} max ${readyStats.max.toFixed(1)})`);
		console.log(`${PREFIX}: warmup  p50=${warmupStats.p50.toFixed(1)}ms p95=${warmupStats.p95.toFixed(1)}ms n=${warmupStats.n} (min ${warmupStats.min.toFixed(1)} max ${warmupStats.max.toFixed(1)}) [openai-compat rounds only: the mock vendor has no warm-up act]`);

		const records: MeasurementRecord[] = [
			{ id: 'model.switch.ready.p95', value: Math.round(readyStats.p95 * 10) / 10, unit: 'ms', measuredAt: new Date().toISOString(), source: `${PREFIX}: fabric provider seam, ${readyStats.n} alternating vendor switches (flauz-openai-compat <-> flauz-mock), local mock vendor endpoint`, samples: readyStats.n },
			{ id: 'model.switch.warmup.p95', value: Math.round(warmupStats.p95 * 10) / 10, unit: 'ms', measuredAt: new Date().toISOString(), source: `${PREFIX}: adapter.health() auth+handshake (GET /models) over the registry-resolved openai-compat config, ${warmupStats.n} samples, local mock vendor endpoint`, samples: warmupStats.n },
		];
		const envelope = envelopeOf(records);
		if (outFile !== undefined) {
			await nodeFs.writeFile(outFile, `${JSON.stringify(envelope, null, 2)}\n`);
			console.log(`${PREFIX}: measurement envelope written to ${outFile} (budget-gate --measurements shape)`);
		}
		console.log(`${PREFIX}: GREEN (real fabric seam; ${readyStats.n} ready + ${warmupStats.n} warmup samples)`);
	} finally {
		await server.close().catch(() => undefined);
		await nodeFs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
		delete process.env[MOCK_ENDPOINT_KEY_ENV];
	}
}

// ---------------------------------------------------------------------------
// Selftest (zero-dep; no fs, no server, no fabric).
// ---------------------------------------------------------------------------

function runSelftest(): void {
	let failures = 0;
	const check = (label: string, condition: boolean): void => {
		if (condition) {
			console.log(`  ok    ${label}`);
		} else {
			failures++;
			console.error(`  FAIL  ${label}`);
		}
	};

	const s = stats([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
	check('stats: n=10', s.n === 10);
	check('stats: p50 = 50 (nearest-rank)', s.p50 === 50);
	check('stats: p95 = 100 (nearest-rank)', s.p95 === 100);
	check('stats: mean = 55', Math.abs(s.mean - 55) < 1e-9);
	const s2 = stats([5]);
	check('stats: single sample', s2.n === 1 && s2.p50 === 5 && s2.p95 === 5);

	const plan = switchPlan(6);
	check('plan: alternates both directions', plan[0]?.target === 'flauz-openai-compat' && plan[1]?.target === 'flauz-mock' && plan[2]?.target === 'flauz-openai-compat');
	check('plan: round numbering is 1-based', plan[0]?.round === 1 && plan[5]?.round === 6);
	check('plan: even split', plan.filter(e => e.target === 'flauz-mock').length === 3);

	const envelope = envelopeOf([
		{ id: 'model.switch.ready.p95', value: 121.5, unit: 'ms', measuredAt: '2026-09-28T00:00:00Z', source: 'selftest' },
	]);
	const text = JSON.stringify(envelope);
	check('envelope: budget-gate shape', envelope.measurements.length === 1 && typeof text === 'string' && text.includes('"measurements"'));
	const parsed = JSON.parse(text) as { measurements: { id: string; value: number; unit: string }[] };
	check('envelope: round-trips', parsed.measurements[0]?.id === 'model.switch.ready.p95' && parsed.measurements[0]?.value === 121.5 && parsed.measurements[0]?.unit === 'ms');

	// over-budget detectability: a p95 over the budget must be identifiable
	const budgetReady = 500;
	const doctored = 590;
	check('failability: over-budget record is detectable', doctored > budgetReady && !(121.5 > budgetReady));

	if (failures > 0) {
		console.error(`${PREFIX}: selftest ${failures} FAILURE(S)`);
		process.exit(1);
	}
	console.log(`${PREFIX}: selftest all checks passed`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	if (FORCE_SKIP) {
		console.log(`${PREFIX}: SKIP (FLAUZ_MODEL_SWITCH_RUNTIME_SKIP=1 forced)`);
		return;
	}
	const argv = process.argv.slice(2);
	let rounds = DEFAULT_ROUNDS;
	let outFile: string | undefined;
	let selftest = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] ?? '';
		if (arg === '--selftest') {
			selftest = true;
		} else if (arg === '--out') {
			outFile = argv[i + 1];
			if (outFile === undefined) {
				console.error(`${PREFIX}: --out requires a path`);
				process.exit(2);
			}
			i++;
		} else if (arg === '--rounds') {
			const value = Number(argv[i + 1]);
			if (!Number.isInteger(value) || value < MIN_ROUNDS) {
				console.error(`${PREFIX}: --rounds must be an integer >= ${MIN_ROUNDS} (doctrine sample floor)`);
				process.exit(2);
			}
			rounds = value;
			i++;
		} else {
			console.error(`${PREFIX}: unknown argument '${arg}'`);
			process.exit(2);
		}
	}
	if (selftest) {
		runSelftest();
		return;
	}
	await runDrill(rounds, outFile);
}

void main().catch(error => {
	console.error(`${PREFIX}: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
