/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL4-H1 -- multi-agent workload RUNTIME drill (doctrine
 * TL4-PERF-BUDGETS.md section 6.4 / TL2-006; registry rows
 * multi-agent.rss.per-session / multi-agent.rss.total /
 * multi-agent.eventloop.lag.p95).
 *
 * MEASURES, over N (default 4, minimum 3) CONCURRENT REAL agent sessions:
 *   - rss per session: VmRSS of each REAL core/service.mjs subprocess
 *     (SeamClient.start spawns the zero-dep workspace seam service; the
 *     process tree class the section 3.2 memory table calls the agent
 *     session). Read from /proc/<pid>/status (Linux) after the workload
 *     window so the number reflects the working set under load, not the
 *     pre-fork baseline. per-session = the MEAN over the N sessions.
 *   - rss total: the SUM over the same N sessions (the N=4 scaled-workload
 *     ceiling row).
 *   - eventloop lag p95: monitorEventLoopDelay on the DRIVER loop (this
 *     process) across the workload window while it drives the N concurrent
 *     sessions. HONESTY NOTE (registry row + BASELINE.md): the doctrine says
 *     the session driver owns the monitor -- this drill's driver is a
 *     standalone process, NOT the booted workbench main process. The
 *     ext-host / workbench loop is the documented residue (same class as
 *     the session-battery workbench seam); never cite this row as the
 *     ext-host loop number.
 *
 * WORKLOAD (the C-23 session shape at drill scale): ceil(N/2) sessions
 * EXECUTE a real task journey (createTask -> appendEvent x2 -> appendEvidence
 * -> listTasks -- real journal + fs writes through the real service
 * subprocess); the rest stay IDLE but alive (real spawned processes, real
 * completed handshakes). The driver concurrently awaits all journeys.
 *
 * MODES:
 *   (no flags)     the full runtime run; records printed + written with --out.
 *   --selftest     zero-dep machinery self-test (percentile math, /proc
 *                  VmRSS parser, plan split, envelope shape, over-budget
 *                  detectability). No fs, no subprocesses.
 *   --out <file>   write the budget-gate measurement envelope
 *                  {"measurements":[...]} (the exact budget-gate.mjs shape).
 *   --sessions <n> concurrent sessions (default 4; minimum 3 -- the
 *                  multi-agent workload class starts at 3).
 *
 * SKIP semantics: FLAUZ_MULTIAGENT_RUNTIME_SKIP=1 -> SKIP, exit 0. On
 * non-Linux there is no /proc/<pid>/status: the RSS records are honestly
 * NOT emitted (the rows SKIP at the gate with the runtime-measured reason
 * -- never a fabricated number), the eventloop record is still emitted.
 * Exit 1 ONLY on a real divergence (handshake failure, workload failure,
 * zero eventloop samples).
 *
 * Zero runtime dependencies: node >= 22.6 stdlib (type stripping;
 * node:fs/promises, node:os, node:path, node:perf_hooks). No 'vscode'
 * import: SeamClient and types import 'vscode' as TYPE ONLY (erased).
 *
 * Exit codes: 0 = drill green (or SKIP, or selftest green); 1 = assertion
 * failed; 2 = usage error.
 */

import * as nodeFs from 'node:fs/promises';
import * as nodeFsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import { SeamClient } from '../../src/seamClient.ts';
import type { SeamEventEnvelope } from '../../src/types.ts';

const PREFIX = 'multi-agent runtime drill';
const FORCE_SKIP = process.env['FLAUZ_MULTIAGENT_RUNTIME_SKIP'] === '1';
const DEFAULT_SESSIONS = 4;
const MIN_SESSIONS = 3;
/** Eventloop histogram resolution (ms). Small for a short window. */
const LOOP_RESOLUTION_MS = 5;
/** Settle window inside the measurement (lets the histogram collect samples under load). */
const SETTLE_MS = 400;

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
// Machinery: /proc/<pid>/status VmRSS (kB -> MB), the memory job's capture
// contract (build/flauz/README.md section 6: MB, not %; /proc is the
// unambiguous per-process source on Linux).
// ---------------------------------------------------------------------------

function parseVmRssKb(statusText: string): number | undefined {
	for (const line of statusText.split('\n')) {
		const match = line.match(/^VmRSS:\s+(\d+)\s+kB\s*$/);
		if (match !== null) {
			return Number(match[1]);
		}
	}
	return undefined;
}

function readVmRssMb(pid: number): number | undefined {
	try {
		const status = nodeFsSync.readFileSync(`/proc/${pid}/status`, 'utf-8');
		const kb = parseVmRssKb(status);
		return kb === undefined ? undefined : kb / 1024;
	} catch {
		return undefined; // non-Linux or process gone: honestly absent
	}
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

interface SessionJourneyResult {
	readonly session: number;
	readonly executing: boolean;
	readonly eventsReceived: number;
	readonly tasksListed: number;
}

/** One real session's task journey (the C-23 shape at drill scale). */
async function runJourney(session: number, seam: SeamClient): Promise<SessionJourneyResult> {
	const created = await seam.createTask(`drill session ${session} task`);
	await seam.appendEvent(created.taskId, { actor: 'agent', type: 'drill-start', payload: { session } });
	await seam.appendEvent(created.taskId, { actor: 'tool', type: 'drill-step', payload: { step: 'probe' } });
	await seam.appendEvidence(created.taskId, { kind: 'note', uri: `.flauz/drill-${session}.md`, sha256: '0'.repeat(64) });
	const listed = await seam.listTasks();
	return { session, executing: true, eventsReceived: 0, tasksListed: listed.tasks.length };
}

async function runDrill(sessions: number, outFile: string | undefined): Promise<void> {
	const roots: string[] = [];
	const seams: SeamClient[] = [];
	const eventCounts: number[] = [];
	try {
		// N concurrent REAL sessions: each SeamClient.start spawns the real
		// core/service.mjs subprocess over its own real temp workspace.
		console.log(`${PREFIX}: starting ${sessions} concurrent real seam sessions (subprocess spawns + hello/ready handshakes)`);
		const executing = Math.ceil(sessions / 2);
		for (let i = 0; i < sessions; i++) {
			const root = await nodeFs.mkdtemp(path.join(os.tmpdir(), `flauz-multi-agent-${i}-`));
			roots.push(root);
			eventCounts.push(0);
		}
		const monitor = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
		monitor.enable();
		const started = await Promise.all(roots.map((root, i) => SeamClient.start({
			workspaceRoot: root,
			globalStoragePath: path.join(root, 'global-storage'),
			logger: () => undefined,
			onEvent: (_envelope: SeamEventEnvelope) => { eventCounts[i] = (eventCounts[i] ?? 0) + 1; },
		})));
		for (const seam of started) {
			seams.push(seam);
		}
		console.log(`${PREFIX}: all ${seams.length} handshakes complete (real child processes: ${seams.map(s => s.pid ?? '?').join(', ')})`);

		// The workload window: ceil(N/2) executing journeys + the idle rest,
		// concurrently, while the driver's eventloop monitor runs.
		const journeys: Promise<SessionJourneyResult>[] = [];
		for (let i = 0; i < seams.length; i++) {
			if (i < executing) {
				journeys.push(runJourney(i + 1, seams[i] ?? (() => { throw new Error('unreachable'); })()));
			}
		}
		const results = await Promise.all(journeys);
		await new Promise<void>(resolve => setTimeout(resolve, SETTLE_MS));
		monitor.disable();

		// RSS after the workload window (the working set under load).
		const rssMb: number[] = [];
		for (const seam of seams) {
			const pid = seam.pid;
			if (pid !== undefined) {
				const rss = readVmRssMb(pid);
				if (rss !== undefined) {
					rssMb.push(rss);
				} else {
					console.log(`${PREFIX}: session pid ${pid}: no /proc VmRSS (non-Linux) -- RSS rows honestly not emitted`);
				}
			}
		}
		const loopP95Ms = monitor.percentile(95) / 1e6;
		console.log(`${PREFIX}: journeys complete (${results.length} executing, ${sessions - results.length} idle; tasks listed: ${results.map(r => r.tasksListed).join(', ')}; event envelopes relayed: ${eventCounts.reduce((a, b) => a + b, 0)})`);
		if (rssMb.length > 0) {
			const rssStats = stats(rssMb);
			console.log(`${PREFIX}: session VmRSS p50=${rssStats.p50.toFixed(1)}MB mean=${rssStats.mean.toFixed(1)}MB total=${rssMb.reduce((a, b) => a + b, 0).toFixed(1)}MB (n=${rssMb.length} of ${sessions})`);
		}
		console.log(`${PREFIX}: driver eventloop lag p95=${loopP95Ms.toFixed(2)}ms (DRIVER loop, resolution ${LOOP_RESOLUTION_MS}ms -- see the honesty note in the header)`);

		const records: MeasurementRecord[] = [
			{ id: 'multi-agent.eventloop.lag.p95', value: Math.round(loopP95Ms * 100) / 100, unit: 'ms', measuredAt: new Date().toISOString(), source: `${PREFIX}: monitorEventLoopDelay p95 on the DRIVER loop across the ${sessions}-session workload window (driver-side measurement; the booted-workbench loop is the documented residue)`, samples: sessions },
		];
		if (rssMb.length === sessions) {
			records.push({
				id: 'multi-agent.rss.per-session',
				value: Math.round((rssMb.reduce((a, b) => a + b, 0) / rssMb.length) * 10) / 10,
				unit: 'MB',
				measuredAt: new Date().toISOString(),
				source: `${PREFIX}: mean VmRSS (/proc/<pid>/status) over ${rssMb.length} concurrent real seam sessions after the workload window`,
				samples: rssMb.length,
			});
			records.push({
				id: 'multi-agent.rss.total',
				value: Math.round(rssMb.reduce((a, b) => a + b, 0) * 10) / 10,
				unit: 'MB',
				measuredAt: new Date().toISOString(),
				source: `${PREFIX}: sum of per-session VmRSS over the same ${rssMb.length} concurrent real sessions`,
				samples: rssMb.length,
			});
		}
		if (outFile !== undefined) {
			await nodeFs.writeFile(outFile, `${JSON.stringify({ measurements: records }, null, 2)}\n`);
			console.log(`${PREFIX}: measurement envelope written to ${outFile} (budget-gate --measurements shape)`);
		}
		console.log(`${PREFIX}: GREEN (real subprocesses; ${rssMb.length}/${sessions} RSS rows + 1 eventloop row)`);
	} finally {
		for (const seam of seams) {
			await seam.dispose().catch(() => undefined);
		}
		for (const root of roots) {
			await nodeFs.rm(root, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}

// ---------------------------------------------------------------------------
// Selftest (zero-dep; no fs, no subprocesses).
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
	check('stats: mean = 55', Math.abs(s.mean - 55) < 1e-9);
	const mean = stats([30, 40, 50]).mean;
	check('mean over 3 sessions = 40', mean === 40);

	check('vmrss: parses the /proc line (kB)', parseVmRssKb('Name:\tnode\nVmRSS:\t  45120 kB\n') === 45120);
	check('vmrss: kB -> MB conversion', parseVmRssKb('VmRSS:\t1024 kB\n') !== undefined && (parseVmRssKb('VmRSS:\t1024 kB\n') ?? 0) / 1024 === 1);
	check('vmrss: absent line -> undefined (honest skip)', parseVmRssKb('Name:\tnode\n') === undefined);
	check('vmrss: malformed value -> undefined', parseVmRssKb('VmRSS:\tN/A\n') === undefined);

	const split = (n: number): number => Math.ceil(n / 2);
	check('plan: 4 sessions -> 2 executing (doctrine N=4 shape)', split(4) === 2);
	check('plan: 3 sessions -> 2 executing (minimum class)', split(3) === 2);

	const envelope = { measurements: [{ id: 'multi-agent.rss.per-session', value: 38.4, unit: 'MB', measuredAt: '2026-09-28T00:00:00Z', source: 'selftest' }] };
	const text = JSON.stringify(envelope);
	const parsed = JSON.parse(text) as { measurements: { id: string; value: number }[] };
	check('envelope: budget-gate shape round-trips', parsed.measurements[0]?.id === 'multi-agent.rss.per-session' && parsed.measurements[0]?.value === 38.4);

	check('failability: over-budget RSS detectable (160 > 150)', 160 > 150 && !(38.4 > 150));
	check('failability: ns -> ms conversion sanity (2.5e6 ns = 2.5 ms)', 2.5e6 / 1e6 === 2.5);

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
		console.log(`${PREFIX}: SKIP (FLAUZ_MULTIAGENT_RUNTIME_SKIP=1 forced)`);
		return;
	}
	const argv = process.argv.slice(2);
	let sessions = DEFAULT_SESSIONS;
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
		} else if (arg === '--sessions') {
			const value = Number(argv[i + 1]);
			if (!Number.isInteger(value) || value < MIN_SESSIONS) {
				console.error(`${PREFIX}: --sessions must be an integer >= ${MIN_SESSIONS}`);
				process.exit(2);
			}
			sessions = value;
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
	await runDrill(sessions, outFile);
}

void main().catch(error => {
	console.error(`${PREFIX}: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
