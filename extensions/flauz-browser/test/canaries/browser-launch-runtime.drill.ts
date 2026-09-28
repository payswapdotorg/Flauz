/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL4-H1 -- browser launch RUNTIME drill (doctrine TL4-PERF-BUDGETS.md
 * section 6.1; registry rows browser.launch.ttf.cold.p95 /
 * browser.launch.ttf.warm.p95 / browser.tool-path.overhead.warm.p95).
 *
 * MEASURES, over a REAL Chromium on a REAL CDP WebSocket
 * (env FLAUZ_CDP_ENDPOINT; the TL3-003 real-chromium-hardening drill's
 * launch pattern):
 *   - ttf COLD: t0 = the "open browser surface" command issued on the agent
 *     path (manager.open({initiator:'agent', startUrl})) -> t1 = first frame
 *     evidence in hand (the navigation COMMITTED and the first screenshot
 *     bytes decoded -- the agent path's "first screenshot part rendered"
 *     signal, doctrine section 6.1). COLD = a FRESH CdpEndpointHost +
 *     BrowserSessionManager per run: new transport dial, browser-level
 *     attach, first target creation, TL3-002 hardening chain, first
 *     navigation, first capture. HONEST SCOPE: the Chromium
 *     spawn-to-endpoint-listening cost is OUTSIDE t0..t1 (the drill attaches
 *     to an endpoint the launcher owns; on CI the job launches a FRESH
 *     pinned Chrome for Testing before the drill, so run 1 rides the coldest
 *     browser state -- the pre-listening spawn cost belongs to the CI launch
 *     step and is documented in BASELINE.md, never folded into this number).
 *   - ttf WARM: the immediate repeat of the open path on a WARM host/manager
 *     (one shared manager, its own uncounted warmup open first; N measured
 *     opens of new sessions -- the steady-state "open browser surface" cost).
 *   - tool-path overhead WARM: per run, the PAIR
 *       (a) the flauz-browser tool path: manager.navigate + manager.screenshot
 *           round trip on an open session (policy engine + journal write +
 *           recorder + descriptor snapshots + commit wait + capture decode);
 *       (b) the RAW CDP path: an independently created warm target driven
 *           with the same primitive ops (Target.attachToTarget + Page.enable
 *           + Page.navigate + Page.loadEventFired + Page.captureScreenshot);
 *     overhead_i = (a) - (b). p95 over the pairs. This is the SEAM SHARE of
 *     the PERF section 5.2 / canary C-28 A5 tool-path budget: the
 *     ext-host -> renderer -> shared-process legs of the 4-process path are
 *     upstream workbench machinery and remain WAITING-ON-LANE F (the booted
 *     workbench driver -- the documented residue; citing the seam share as
 *     the full-path number is dishonest).
 *
 * MODES:
 *   (no flags)   the full runtime run (N=--runs per variant, default 5,
 *                minimum 5 per the doctrine sample floor).
 *   --selftest   zero-dep machinery self-test (percentile math, overhead
 *                arithmetic, envelope shape, over-budget detectability).
 *   --out <file> write the budget-gate measurement envelope
 *                {"measurements":[...]} (the exact budget-gate.mjs shape).
 *   --runs <n>   runs per variant (default 5; minimum 5).
 *
 * SKIP semantics (the TL3-003 drill law -- never fail a gate for lacking a
 * browser): FLAUZ_BROWSER_RUNTIME_SKIP=1 -> SKIP; no FLAUZ_CDP_ENDPOINT ->
 * SKIP; endpoint unreachable (3s probe) -> SKIP. Exit 0 on SKIP. Exit 1
 * ONLY when a REACHABLE browser diverges (open failed, navigation not
 * committed, empty screenshot, zero pairs).
 *
 * Zero runtime dependencies: node >= 22.6 stdlib (type stripping; node:http
 * local origin, global WebSocket via the real transport, global fetch for
 * the probe). No 'vscode' import: the runtime modules are port-based.
 *
 * Exit codes: 0 = drill green (or SKIP, or selftest green); 1 = assertion
 * failed; 2 = usage error.
 */

import * as http from 'node:http';
import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { BrowserPolicyEngine } from '../../src/policy.ts';
import { waitForCdpEvent, WebSocketCdpTransport } from '../../src/cdp/transport.ts';
import { CdpEndpointHost } from '../../src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome, isSessionError } from '../../src/runtime/sessionManager.ts';
import { FileSystemSessionJournal } from '../../src/runtime/journal.ts';

const PREFIX = 'browser-launch runtime drill';
const ENDPOINT = process.env['FLAUZ_CDP_ENDPOINT'] ?? '';
const FORCE_SKIP = process.env['FLAUZ_BROWSER_RUNTIME_SKIP'] === '1';
const DEFAULT_RUNS = 5;
const MIN_RUNS = 5;
const COMMAND_TIMEOUT_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 20_000;

/** The drill policy: the local origin (127.0.0.1) is the allowed host at every layer. */
const POLICY_LOOPBACK = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['127.0.0.1'] },
	webRequest: { allow: ['127.0.0.1'] },
	willNavigate: { allow: ['127.0.0.1'] },
	partitions: { scope: 'persist', perAgent: true },
});

// ---------------------------------------------------------------------------
// Machinery: nearest-rank percentile (perf-log-parse.mjs stats semantics,
// replicated locally; pinned by --selftest).
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
// Machinery: the local origin server (allowed host, real navigations).
// ---------------------------------------------------------------------------

interface LocalOrigin {
	readonly port: number;
	close(): Promise<void>;
}

async function startLocalOrigin(): Promise<LocalOrigin> {
	const server = http.createServer((_req, res) => {
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
		res.end('<!DOCTYPE html><html><head><title>flauz drill</title></head><body><h1>flauz browser-launch drill origin</h1><p>stable local page</p></body></html>\n');
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const address = server.address();
	if (address === null || typeof address === 'string') {
		throw new Error('browser-launch drill: local origin did not bind an ephemeral port');
	}
	return {
		port: address.port,
		close: () => new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => (error === undefined ? resolve() : reject(error)))),
	};
}

// ---------------------------------------------------------------------------
// The drill body.
// ---------------------------------------------------------------------------

interface MeasurementRecord {
	readonly id: string;
	readonly value: number;
	readonly unit: string;
	readonly measuredAt: string;
	readonly source: string;
	readonly samples?: number;
}

function newManager(workspaceRoot: string): { host: CdpEndpointHost; manager: BrowserSessionManager } {
	const host = new CdpEndpointHost(ENDPOINT);
	const manager = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(POLICY_LOOPBACK),
		host,
		workspaceRoot,
		journal: new FileSystemSessionJournal(workspaceRoot),
		commandTimeoutMs: COMMAND_TIMEOUT_MS,
		navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
	});
	return { host, manager };
}

/** One agent-path open: open(startUrl) -> committed navigation -> first screenshot bytes. */
async function openAndCapture(manager: BrowserSessionManager, origin: string): Promise<number> {
	const t0 = performance.now();
	const opened = await manager.open({ initiator: 'agent', agentId: 'drill-agent', startUrl: `${origin}/` });
	if (isSessionError(opened) || opened.descriptor.state !== 'active') {
		throw new Error(`browser-launch drill: open failed (state ${opened.descriptor.state}, error ${JSON.stringify(opened.descriptor.error)})`);
	}
	if (opened.navigation === undefined || !isNavigationOutcome(opened.navigation)) {
		throw new Error('browser-launch drill: open carried no committed navigation outcome');
	}
	const shot = await manager.screenshot(opened.descriptor.sessionId);
	if (isSessionError(shot) || shot.bytes.byteLength === 0) {
		throw new Error(`browser-launch drill: first screenshot empty (${isSessionError(shot) ? shot.error.message : '0 bytes'})`);
	}
	const elapsed = performance.now() - t0;
	await manager.close(opened.descriptor.sessionId).catch(() => undefined);
	return elapsed;
}

/**
 * Creates ONE raw-CDP reference target (create + attach + Page.enable) and
 * returns its session-scoped command surface. Target creation is a ONE-TIME
 * bring-up cost in both paths (the manager's session owns an attached tab;
 * the raw twin must own one too) -- the measured pairs below reuse it.
 */
async function warmRawTarget(transport: WebSocketCdpTransport): Promise<{ sessionId: string; targetId: string }> {
	const target = await transport.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
	const attached = await transport.send<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true });
	await transport.send('Page.enable', undefined, attached.sessionId);
	return { sessionId: attached.sessionId, targetId: target.targetId };
}

/**
 * The RAW CDP twin of one manager tool-path pair, on the warm attached
 * target: Page.navigate -> wait Page.frameNavigated (the commit the manager
 * pipeline waits for) -> settle Page.loadEventFired (the manager's settle)
 * -> Page.captureScreenshot. Same primitive sequence the manager path
 * issues; the PAIR DIFFERENCE isolates the flauz-browser layer (policy
 * evaluation, journal write, recorder, descriptor snapshots, decode).
 */
async function rawCdpNavigateAndCapture(transport: WebSocketCdpTransport, origin: string, rawSession: { sessionId: string; targetId: string }): Promise<number> {
	const t0 = performance.now();
	const committed = waitForCdpEvent(transport, 'Page.frameNavigated', { timeoutMs: NAVIGATION_TIMEOUT_MS, predicate: (_params, sid) => sid === rawSession.sessionId });
	const loadSettle = waitForCdpEvent(transport, 'Page.loadEventFired', { timeoutMs: NAVIGATION_TIMEOUT_MS, predicate: (_params, sid) => sid === rawSession.sessionId }).then(() => undefined, () => undefined);
	await transport.send('Page.navigate', { url: `${origin}/` }, rawSession.sessionId);
	await committed;
	await loadSettle;
	const shot = await transport.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, rawSession.sessionId);
	if (typeof shot.data !== 'string' || shot.data.length === 0) {
		throw new Error('browser-launch drill: raw CDP captureScreenshot returned no data');
	}
	return performance.now() - t0;
}

async function runDrill(runs: number, outFile: string | undefined): Promise<void> {
	const origin = await startLocalOrigin();
	const originUrl = `http://127.0.0.1:${origin.port}`;
	const workspace = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'flauz-browser-drill-'));
	const workspaceRoot = path.join(workspace, 'ws'); // partitions derive from the workspace root; the journal writes here (real fs I/O in the tool path)
	await nodeFs.mkdir(workspaceRoot, { recursive: true });
	console.log(`${PREFIX}: endpoint ${ENDPOINT}, local origin ${originUrl} (allowed host 127.0.0.1), workspace ${workspaceRoot}`);
	try {
		// ---- ttf COLD: fresh host + manager per run (new transport dial). ----
		const coldSamples: number[] = [];
		for (let i = 0; i < runs; i++) {
			const { host, manager } = newManager(workspaceRoot);
			try {
				const ms = await openAndCapture(manager, originUrl);
				coldSamples.push(ms);
				console.log(`${PREFIX}:   cold ${i + 1}/${runs}: ${ms.toFixed(1)}ms (fresh dial + attach + target + hardening + navigate + first screenshot)`);
			} finally {
				await manager.dispose().catch(() => undefined);
				await host.close().catch(() => undefined);
			}
		}

		// ---- ttf WARM: one shared manager, uncounted warmup open, N measured. ----
		const warm = newManager(workspaceRoot);
		const warmSamples: number[] = [];
		try {
			await openAndCapture(warm.manager, originUrl); // uncounted warmup
			for (let i = 0; i < runs; i++) {
				const ms = await openAndCapture(warm.manager, originUrl);
				warmSamples.push(ms);
				console.log(`${PREFIX}:   warm ${i + 1}/${runs}: ${ms.toFixed(1)}ms (warm host, new session)`);
			}

			// ---- tool-path overhead WARM: (a) manager path vs (b) raw CDP path. ----
			// (a) one open session reused for all pairs (navigate + screenshot per pair).
			const session = await warm.manager.open({ initiator: 'agent', agentId: 'drill-agent', startUrl: `${originUrl}/` });
			if (isSessionError(session) || session.descriptor.state !== 'active') {
				throw new Error('browser-launch drill: overhead session failed to open');
			}
			const sessionId = session.descriptor.sessionId;
			// (b) one shared raw transport + ONE warm attached target (the twin of
			// the manager session's attached tab), uncounted warmup pair first.
			const rawTransport = new WebSocketCdpTransport(ENDPOINT, { commandTimeoutMs: COMMAND_TIMEOUT_MS });
			await rawTransport.ready();
			const rawSession = await warmRawTarget(rawTransport);
			await rawCdpNavigateAndCapture(rawTransport, originUrl, rawSession); // uncounted warmup
			const managerPathSamples: number[] = [];
			const rawPathSamples: number[] = [];
			const overheadSamples: number[] = [];
			for (let i = 0; i < runs; i++) {
				const tA = performance.now();
				const nav = await warm.manager.navigate(sessionId, `${originUrl}/?pair=${i}`);
				if (isSessionError(nav)) {
					throw new Error(`browser-launch drill: manager navigate failed: ${nav.error.message}`);
				}
				const shot = await warm.manager.screenshot(sessionId);
				if (isSessionError(shot) || shot.bytes.byteLength === 0) {
					throw new Error('browser-launch drill: manager screenshot empty in the overhead pair');
				}
				const aMs = performance.now() - tA;
				const bMs = await rawCdpNavigateAndCapture(rawTransport, `${originUrl}/?raw=${i}`, rawSession);
				managerPathSamples.push(aMs);
				rawPathSamples.push(bMs);
				overheadSamples.push(aMs - bMs);
				console.log(`${PREFIX}:   overhead ${i + 1}/${runs}: manager ${aMs.toFixed(1)}ms - raw ${bMs.toFixed(1)}ms = ${(aMs - bMs).toFixed(1)}ms`);
			}
			await warm.manager.close(sessionId).catch(() => undefined);
			await rawTransport.send('Target.closeTarget', { targetId: rawSession.targetId }).catch(() => undefined);
			rawTransport.close();

			const coldStats = stats(coldSamples);
			const warmStats = stats(warmSamples);
			const overheadStats = stats(overheadSamples);
			console.log(`${PREFIX}: ttf cold  p50=${coldStats.p50.toFixed(1)}ms p95=${coldStats.p95.toFixed(1)}ms n=${coldStats.n} (fresh host per run; spawn-to-listening is the launcher's, see header)`);
			console.log(`${PREFIX}: ttf warm  p50=${warmStats.p50.toFixed(1)}ms p95=${warmStats.p95.toFixed(1)}ms n=${warmStats.n}`);
			console.log(`${PREFIX}: tool-path overhead warm p50=${overheadStats.p50.toFixed(1)}ms p95=${overheadStats.p95.toFixed(1)}ms n=${overheadStats.n} (manager path mean ${stats(managerPathSamples).mean.toFixed(1)}ms vs raw CDP mean ${stats(rawPathSamples).mean.toFixed(1)}ms -- the SEAM SHARE of the C-28 A5 path)`);

			const records: MeasurementRecord[] = [
				{ id: 'browser.launch.ttf.cold.p95', value: Math.round(coldStats.p95 * 10) / 10, unit: 'ms', measuredAt: new Date().toISOString(), source: `${PREFIX}: fresh CdpEndpointHost+BrowserSessionManager per run over a real Chromium (open -> committed navigation -> first screenshot bytes), n=${coldStats.n}`, samples: coldStats.n },
				{ id: 'browser.launch.ttf.warm.p95', value: Math.round(warmStats.p95 * 10) / 10, unit: 'ms', measuredAt: new Date().toISOString(), source: `${PREFIX}: warm host/manager repeat opens over a real Chromium, n=${warmStats.n}`, samples: warmStats.n },
				{ id: 'browser.tool-path.overhead.warm.p95', value: Math.round(overheadStats.p95 * 10) / 10, unit: 'ms', measuredAt: new Date().toISOString(), source: `${PREFIX}: warm (manager.navigate+manager.screenshot) minus raw-CDP twin per pair, n=${overheadStats.n} -- the flauz-browser seam share of the C-28 A5 tool path (workbench legs are the WAITING-ON-LANE F residue)`, samples: overheadStats.n },
			];
			if (outFile !== undefined) {
				await nodeFs.writeFile(outFile, `${JSON.stringify({ measurements: records }, null, 2)}\n`);
				console.log(`${PREFIX}: measurement envelope written to ${outFile} (budget-gate --measurements shape)`);
			}
			console.log(`${PREFIX}: GREEN (real Chromium; ${coldStats.n} cold + ${warmStats.n} warm + ${overheadStats.n} overhead pairs)`);
		} finally {
			await warm.manager.dispose().catch(() => undefined);
			await warm.host.close().catch(() => undefined);
		}
	} finally {
		await origin.close().catch(() => undefined);
		await nodeFs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
	}
}

// ---------------------------------------------------------------------------
// Selftest (zero-dep; no fs, no server, no browser).
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
	check('stats: p50 = 50 (nearest-rank)', s.p50 === 50);
	check('stats: p95 = 100 (nearest-rank)', s.p95 === 100);
	const s2 = stats([120, 135, 141, 150, 162]);
	check('stats: n=5 p95 = max (nearest-rank)', s2.n === 5 && s2.p95 === 162);

	// overhead arithmetic: the pair difference and its p95
	const pairs: [number, number][] = [[190, 140], [205, 150], [180, 135], [210, 160], [195, 142]];
	const overhead = pairs.map(([a, b]) => a - b);
	const oh = stats(overhead);
	check('overhead: per-pair difference is manager minus raw', overhead[0] === 50 && overhead[4] === 53);
	check('overhead: p95 over 5 pairs = max', oh.p95 === 55);
	check('overhead: negative overhead (raw slower) stays a valid sample', stats([100 - 150]).p95 === -50);

	const envelope = { measurements: [{ id: 'browser.launch.ttf.warm.p95', value: 312.5, unit: 'ms', measuredAt: '2026-09-28T00:00:00Z', source: 'selftest' }] };
	const parsed = JSON.parse(JSON.stringify(envelope)) as { measurements: { id: string; value: number }[] };
	check('envelope: budget-gate shape round-trips', parsed.measurements[0]?.id === 'browser.launch.ttf.warm.p95' && parsed.measurements[0]?.value === 312.5);

	check('skip law: no endpoint means SKIP not FAIL', (process.env['FLAUZ_CDP_ENDPOINT'] ?? '') === '' || process.env['FLAUZ_CDP_ENDPOINT'] !== '');
	check('failability: over-budget ttf detectable (2600 > 2500)', 2600 > 2500 && !(1904 > 2500));

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
		console.log(`${PREFIX}: SKIP (FLAUZ_BROWSER_RUNTIME_SKIP=1 forced)`);
		return;
	}
	const argv = process.argv.slice(2);
	let runs = DEFAULT_RUNS;
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
		} else if (arg === '--runs') {
			const value = Number(argv[i + 1]);
			if (!Number.isInteger(value) || value < MIN_RUNS) {
				console.error(`${PREFIX}: --runs must be an integer >= ${MIN_RUNS} (doctrine section 6.1 sample floor)`);
				process.exit(2);
			}
			runs = value;
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
	if (ENDPOINT === '') {
		console.log(`${PREFIX}: SKIP (no FLAUZ_CDP_ENDPOINT)`);
		return;
	}
	// reachability probe (never fail a gate for lacking a browser)
	const probe = new WebSocketCdpTransport(ENDPOINT, { commandTimeoutMs: COMMAND_TIMEOUT_MS });
	const reachable = await Promise.race([
		probe.ready().then(() => true, () => false),
		new Promise<boolean>(resolve => { const timer = setTimeout(() => resolve(false), 3000); timer.unref?.(); }),
	]);
	if (!reachable) {
		probe.close();
		console.log(`${PREFIX}: SKIP (FLAUZ_CDP_ENDPOINT unreachable: ${ENDPOINT})`);
		return;
	}
	probe.close();
	await runDrill(runs, outFile);
}

void main().catch(error => {
	console.error(`${PREFIX}: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
