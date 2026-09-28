/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Tests for build/flauz/scripts/compat-l3-smoke.mjs (TL4-008 - the L3 runtime
// boot smoke driver). Black-box CLI tests: the driver is spawned exactly the
// way the CI lane and verify-fixtures.sh spawn it, against the fixture matrix
// under test/fixtures/compat-l3/ plus in-test fake CDP servers and child-mode
// stubs (no workbench is ever booted in a worker sandbox - MIGRATION-PLAN 5).
//
// Run with:
//   node --test build/flauz/compat-l3-smoke.test.mjs
//
// A gate that cannot fail is not a gate: every FAIL-capable row class of the
// driver has a case here (or a verify-fixtures.sh case) that makes it fail.
// ---------------------------------------------------------------------------------------------

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // build/flauz -> repo root
const DRIVER = path.join(ROOT, 'build', 'flauz', 'scripts', 'compat-l3-smoke.mjs');
const FIX = path.join(ROOT, 'test', 'fixtures', 'compat-l3');

// async spawn (NEVER spawnSync): the in-test fake CDP servers live in this
// process - a sync spawn would block the event loop and starve them.
function runDriver(args) {
	return new Promise((resolve) => {
		const p = spawn(process.execPath, [DRIVER, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '', stderr = '';
		p.stdout.on('data', (d) => { stdout += d; });
		p.stderr.on('data', (d) => { stderr += d; });
		const killer = setTimeout(() => { p.kill('SIGKILL'); }, 60000);
		p.on('close', (code) => { clearTimeout(killer); resolve({ status: code, stdout, stderr }); });
		p.on('error', (e) => { clearTimeout(killer); resolve({ status: null, stdout, stderr: String(e) }); });
	});
}

async function runDriverJson(args) {
	const r = await runDriver([...args, '--json']);
	let meta = null;
	try { meta = JSON.parse(r.stdout); } catch { /* surfaced by the asserts below */ }
	return { status: r.status, meta, stdout: r.stdout, stderr: r.stderr };
}

function row(meta, id) {
	const r = meta?.rows?.find((x) => x.id === id);
	assert.ok(r !== undefined, `row '${id}' present (rows: ${meta?.rows?.map((x) => x.id).join(', ') ?? 'no meta'})`);
	return r;
}

function startCdp(versionBody, listBody) {
	const server = http.createServer((req, res) => {
		if (req.url === '/json/version') {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify(versionBody));
			return;
		}
		if (req.url === '/json/list') {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify(listBody));
			return;
		}
		res.writeHead(404); res.end('not found');
	});
	return new Promise((resolve) => { server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })); });
}

function freePort() {
	// grab an ephemeral port and close the listener: the CI-side race window
	// is negligible and the assertion only needs "nothing answers here"
	return new Promise((resolve) => {
		const s = net.createServer();
		s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
	});
}

const FAST = ['--settle-timeout', '300', '--poll-interval', '100'];

// ---- fixture corpus: the PASS shape ----

test('clean fixture: logs + compile root -> PASS (10 PASS / 0 FAIL / 8 SKIP, exit 0)', async () => {
	const { status, meta } = await runDriverJson([
		'--log', path.join(FIX, 'logs-clean', 'boot.log'),
		'--log-dir', path.join(FIX, 'logs-clean', 'userdata-logs'),
		'--compile-root', path.join(FIX, 'fake-out'),
		...FAST,
	]);
	assert.equal(status, 0);
	assert.equal(meta.verdict, 'PASS');
	assert.equal(meta.counts.PASS, 10);
	assert.equal(meta.counts.FAIL, 0);
	assert.equal(meta.counts.SKIP, 8);
	assert.equal(row(meta, 'workbench.log-clean').status, 'PASS');
	assert.equal(row(meta, 'ext.host-started').status, 'PASS');
	assert.equal(row(meta, 'ext.flauz-activated').status, 'PASS');
	assert.match(row(meta, 'ext.flauz-activated').detail, /flauz\.flauz-agent, flauz\.flauz-workspace/);
	for (const p of ['terminal', 'scm', 'palette', 'settings', 'notebook', 'debug', 'remote']) {
		assert.equal(row(meta, `pillar.${p}.compiled`).status, 'PASS', `pillar.${p}.compiled`);
	}
});

// ---- fixture corpus: the FAIL shapes (a gate that cannot fail is not a gate) ----

test('fatal fixture: log-clean FAIL names file, line and pattern (exit 1)', async () => {
	const { status, meta } = await runDriverJson(['--log', path.join(FIX, 'logs-fatal', 'boot.log'), ...FAST]);
	assert.equal(status, 1);
	assert.equal(meta.verdict, 'FAIL');
	const r = row(meta, 'workbench.log-clean');
	assert.equal(r.status, 'FAIL');
	assert.match(r.detail, /terminated unexpectedly/);
	assert.match(r.detail, /boot\.log:8/);
});

test('no-ext fixture: both extension rows FAIL when the host never started (exit 1)', async () => {
	const { status, meta } = await runDriverJson(['--log', path.join(FIX, 'logs-no-ext', 'boot.log'), ...FAST]);
	assert.equal(status, 1);
	assert.equal(row(meta, 'ext.host-started').status, 'FAIL');
	assert.equal(row(meta, 'ext.flauz-activated').status, 'FAIL');
	assert.equal(row(meta, 'workbench.log-clean').status, 'PASS');
});

test('no-flauz fixture: host PASSes but the flauz activation control FAILs (exit 1)', async () => {
	const { status, meta } = await runDriverJson(['--log', path.join(FIX, 'logs-no-flauz', 'boot.log'), ...FAST]);
	assert.equal(status, 1);
	assert.equal(row(meta, 'ext.host-started').status, 'PASS');
	assert.equal(row(meta, 'ext.flauz-activated').status, 'FAIL');
	assert.match(row(meta, 'ext.flauz-activated').detail, /positive control/);
});

test('missing pillar file: the compile row FAILs with the missing path (exit 1)', async () => {
	const { status, meta } = await runDriverJson(['--compile-root', path.join(FIX, 'fake-out-missing')]);
	assert.equal(status, 1);
	const r = row(meta, 'pillar.terminal.compiled');
	assert.equal(r.status, 'FAIL');
	assert.match(r.detail, /terminal\.contribution\.js/);
	assert.equal(row(meta, 'pillar.scm.compiled').status, 'PASS');
});

test('explicit compile root that does not exist: rows FAIL loudly (exit 1)', async () => {
	const { status, meta } = await runDriverJson(['--compile-root', path.join(FIX, 'no-out')]);
	assert.equal(status, 1);
	assert.equal(row(meta, 'pillar.terminal.compiled').status, 'FAIL');
});

// ---- CDP rows against in-test fake endpoints ----

test('cdp good: /json/version + workbench page target -> both boot rows PASS (exit 0)', async () => {
	const { server, port } = await startCdp(
		{ Browser: 'Electron/37.2.1', 'Protocol-Version': '1.3' },
		[{ type: 'page', url: 'file:///repo/out/vs/code/electron-sandbox/workbench/workbench.html', title: 'index.html' }],
	);
	try {
		const { status, meta } = await runDriverJson(['--cdp-port', String(port), '--boot-timeout', '3000', '--poll-interval', '100', ...FAST]);
		assert.equal(status, 0);
		assert.equal(row(meta, 'boot.cdp-reachable').status, 'PASS');
		assert.match(row(meta, 'boot.cdp-reachable').detail, /Electron\/37\.2\.1/);
		assert.equal(row(meta, 'boot.workbench-target').status, 'PASS');
		assert.match(row(meta, 'boot.workbench-target').detail, /workbench\.html/);
	} finally {
		server.close();
	}
});

test('cdp bad target: no workbench page among targets -> workbench-target FAILs (exit 1)', async () => {
	const { server, port } = await startCdp(
		{ Browser: 'Electron/37.2.1' },
		[{ type: 'page', url: 'about:blank', title: 'blank' }, { type: 'node', url: 'file:///repo/out/main.js' }],
	);
	try {
		const { status, meta } = await runDriverJson(['--cdp-port', String(port), '--boot-timeout', '3000', '--poll-interval', '100', ...FAST]);
		assert.equal(status, 1);
		assert.equal(row(meta, 'boot.cdp-reachable').status, 'PASS');
		assert.equal(row(meta, 'boot.workbench-target').status, 'FAIL');
	} finally {
		server.close();
	}
});

test('cdp endpoint not CDP (404): boot.cdp-reachable FAILs (exit 1)', async () => {
	const server = http.createServer((req, res) => { res.writeHead(404); res.end('no'); });
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = server.address().port;
	try {
		const { status, meta } = await runDriverJson(['--cdp-port', String(port), '--boot-timeout', '1500', '--poll-interval', '100', ...FAST]);
		assert.equal(status, 1);
		const r = row(meta, 'boot.cdp-reachable');
		assert.equal(r.status, 'FAIL');
		assert.match(r.detail, /HTTP 404/);
	} finally {
		server.close();
	}
});

test('cdp nothing listens: readiness times out with the attempt count (exit 1)', async () => {
	const port = await freePort();
	const { status, meta } = await runDriverJson(['--cdp-port', String(port), '--boot-timeout', '400', '--poll-interval', '100', ...FAST]);
	assert.equal(status, 1);
	const r = row(meta, 'boot.cdp-reachable');
	assert.equal(r.status, 'FAIL');
	assert.match(r.detail, /within 400 ms/);
	assert.equal(row(meta, 'boot.workbench-target').status, 'FAIL');
});

// ---- child mode: the driver owns the process ----

test('child mode: natural exit 0 + activation markers on stderr -> exit-clean and ext rows PASS (exit 0)', async () => {
	const script = [
		"console.error('[exthost] [info] ExtensionService#_doActivateExtension flauz.flauz-agent, startup: false, activationEvent: onStartupFinished');",
		"console.error('[exthost] [info] Eager extensions activated');",
		'process.exit(0);',
	].join(' ');
	const { status, meta } = await runDriverJson(['--cmd', process.execPath, '--arg=-e', `--arg=${script}`, '--boot-timeout', '5000', ...FAST]);
	assert.equal(status, 0);
	assert.equal(meta.mode, 'child');
	const exitRow = row(meta, 'boot.exit-clean');
	assert.equal(exitRow.status, 'PASS');
	assert.match(exitRow.detail, /natural exit 0/);
	assert.equal(row(meta, 'ext.host-started').status, 'PASS');
	assert.equal(row(meta, 'ext.flauz-activated').status, 'PASS');
	assert.equal(row(meta, 'workbench.log-clean').status, 'PASS');
});

test('child mode: nonzero exit -> boot.exit-clean FAILs with the code (exit 1)', async () => {
	const { status, meta } = await runDriverJson(['--cmd', process.execPath, '--arg=-e', '--arg=process.exit(7);', '--boot-timeout', '5000', ...FAST]);
	assert.equal(status, 1);
	const exitRow = row(meta, 'boot.exit-clean');
	assert.equal(exitRow.status, 'FAIL');
	assert.match(exitRow.detail, /exited 7/);
});

// ---- report modes and the CI contract ----

test('--out writes the JSON report file (parent dirs created)', async () => {
	const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'compat-l3-out-')), 'nested', 'report.json');
	const r = await runDriver(['--log', path.join(FIX, 'logs-clean', 'boot.log'), '--log-dir', path.join(FIX, 'logs-clean', 'userdata-logs'), '--compile-root', path.join(FIX, 'fake-out'), '--out', out, ...FAST]);
	assert.equal(r.status, 0);
	const meta = JSON.parse(fs.readFileSync(out, 'utf8'));
	assert.equal(meta.tool, 'compat-l3-smoke');
	assert.equal(meta.verdict, 'PASS');
});

test('--no-fail reports the divergence but exits 0', async () => {
	const r = await runDriver(['--log', path.join(FIX, 'logs-fatal', 'boot.log'), '--no-fail', ...FAST]);
	assert.equal(r.status, 0);
	assert.match(r.stdout, /FAIL  workbench\.log-clean/);
});

test('--require without a boot channel refuses to run (exit 2)', async () => {
	const r = await runDriver(['--require', '--log', path.join(FIX, 'logs-clean', 'boot.log')]);
	assert.equal(r.status, 2);
	assert.match(r.stderr, /live boot channel/);
});

test('usage error: unknown flag (exit 2)', async () => {
	const r = await runDriver(['--definitely-not-a-flag']);
	assert.equal(r.status, 2);
});

test('--help exits 0 and documents the exit-code table', async () => {
	const r = await runDriver(['--help']);
	assert.equal(r.status, 0);
	assert.match(r.stdout, /Exit codes: 0 pass\/SKIP-only \(or --no-fail\) - 1 divergence - 2 usage/);
});
