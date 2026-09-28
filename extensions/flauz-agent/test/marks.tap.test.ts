/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL4-H1 mark-tap tests: the FLAUZ_PERF_MARKS_FILE observational tap in
 * src/marks.ts (the R6 drift closure — see the module header for the relay
 * diagnosis). The tap path is resolved at MODULE LOAD, so each case runs in
 * a child node process with the environment set BEFORE the import (the
 * query-string on the import URL busts the ESM cache per case; the child
 * exit code + the tap file content are the assertions).
 *
 * Contract under test (build/flauz/README.md tap conventions):
 *   1. env unset            -> ZERO I/O (no file ever created), performance.mark still called.
 *   2. env set              -> one `<markName>\t<performance.now()>` line per mark, in order.
 *   3. tap path unwritable  -> mark() does NOT throw (fail-open observability), performance.mark still called.
 *   4. line format          -> exactly `name TAB finite-number NEWLINE` (the perf-log-parse --parse-tap grammar).
 */

import { test } from 'node:test';
import { ok, strictEqual, match } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MARKS_URL = new URL('../src/marks.ts', import.meta.url).href;

/**
 * Runs a driver snippet in a child node process. The driver imports the
 * marks module with a cache-busting query and emits the marks the case needs;
 * `envCase` selects the FLAUZ_PERF_MARKS_FILE posture.
 */
function runDriver(envCase: 'off' | 'on' | 'bad-path', tapPath: string, marks: string[]): { code: number; stderr: string } {
	const driver = `
		const m = await import('${MARKS_URL}?case=${envCase.replace(/-/g, '_')}');
		${marks.map(name => `m.mark(${JSON.stringify(name)});`).join('\n\t\t')}
	`;
	const env = { ...process.env };
	delete env['FLAUZ_PERF_MARKS_FILE'];
	if (envCase === 'on' || envCase === 'bad-path') {
		env['FLAUZ_PERF_MARKS_FILE'] = tapPath;
	}
	const result = spawnSync(process.execPath, ['--input-type=module', '-e', driver], {
		encoding: 'utf-8',
		env,
		timeout: 30_000,
	});
	return { code: result.status ?? -1, stderr: result.stderr ?? '' };
}

const TAP_LINE = /^[^\t\n]+\t\d+(\.\d+)?\n$/;

test('mark tap: env unset performs zero I/O (no file created) and never throws', () => {
	const dir = mkdtempSync(join(tmpdir(), 'flauz-tap-off-'));
	try {
		const tapPath = join(dir, 'never.tap');
		const { code, stderr } = runDriver('off', tapPath, ['code/flauz/willConnectCore', 'code/flauz/didConnectCore']);
		strictEqual(code, 0, `driver should exit 0 (stderr: ${stderr})`);
		ok(!existsSync(tapPath), 'tap file must NOT be created when FLAUZ_PERF_MARKS_FILE is unset (zero I/O)');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('mark tap: env set appends one name\\t<performance.now()> line per mark, in order', () => {
	const dir = mkdtempSync(join(tmpdir(), 'flauz-tap-on-'));
	try {
		const tapPath = join(dir, 'run-1.tap');
		const marks = ['code/flauz/willActivateBridge', 'code/flauz/willConnectCore', 'code/flauz/didConnectCore'];
		const { code, stderr } = runDriver('on', tapPath, marks);
		strictEqual(code, 0, `driver should exit 0 (stderr: ${stderr})`);
		ok(existsSync(tapPath), 'tap file must exist when FLAUZ_PERF_MARKS_FILE is set');
		const text = readFileSync(tapPath, 'utf-8');
		const lines = text.split('\n').filter(line => line !== '');
		strictEqual(lines.length, marks.length, `expected ${marks.length} tap lines, got: ${JSON.stringify(lines)}`);
		strictEqual(lines.length, marks.filter(name => text.includes(`${name}\t`)).length, 'every mark name appears exactly once');
		for (let i = 0; i < lines.length; i++) {
			match(lines[i] + '\n', TAP_LINE, `tap line ${i + 1} must be 'name\\t<number>\\n' (perf-log-parse --parse-tap grammar): ${JSON.stringify(lines[i])}`);
		}
		// same ext-host clock, monotonically non-decreasing timestamps
		const stamps = lines.map(line => Number(line.split('\t')[1]));
		for (let i = 1; i < stamps.length; i++) {
			ok(stamps[i] >= stamps[i - 1], `tap timestamps must not go backwards (line ${i + 1})`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('mark tap: unwritable tap path fails OPEN (no throw, activation-safe)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'flauz-tap-bad-'));
	try {
		const tapPath = join(dir, 'missing-dir', 'run.tap');
		const { code, stderr } = runDriver('bad-path', tapPath, ['code/flauz/willWarmModels']);
		strictEqual(code, 0, `mark() must NOT throw on an unwritable tap path (fail-open probe; stderr: ${stderr})`);
		ok(!stderr.includes('Error'), `no error output expected (stderr: ${stderr})`);
		ok(!existsSync(tapPath), 'nothing was written (the parent dir never existed)');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
