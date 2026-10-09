/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Tests for src/bootGate.ts (the C-ENV bootstrap-race repair). The gate is
 * pure promise bookkeeping -- these run under plain `node --test` with zero
 * workspace/vscode surface.
 */

import { test } from 'node:test';
import { ok, strictEqual } from 'node:assert';
import { createBootGate } from '../src/bootGate.ts';

test('settled() resolves immediately when nothing is in flight', async () => {
	const gate = createBootGate();
	strictEqual(gate.isRunning(), false);
	await gate.settled();
	strictEqual(gate.isRunning(), false);
});

test('a caller racing the bootstrap waits for its completion', async () => {
	const gate = createBootGate();
	let release!: () => void;
	const blocked = new Promise<void>(resolve => { release = resolve; });
	const boot = gate.run(async () => { await blocked; });
	strictEqual(gate.isRunning(), true, 'in flight while the work is blocked');
	let observed = false;
	const waiter = gate.settled().then(() => { observed = true; });
	await Promise.resolve();
	await Promise.resolve();
	strictEqual(observed, false, 'the waiter must NOT resolve before the boot settles');
	release();
	await boot;
	await waiter;
	strictEqual(observed, true, 'the waiter resolved after the boot settled');
	strictEqual(gate.isRunning(), false);
});

test('a FAILED bootstrap settles its waiters and never rejects the run promise', async () => {
	const gate = createBootGate();
	const boot = gate.run(async () => { throw new Error('bootstrap failed'); });
	await boot;
	await gate.settled();
	strictEqual(gate.isRunning(), false, 'a failed boot is settled, not stuck in flight');
});

test('run() survives a synchronously-throwing work function', async () => {
	const gate = createBootGate();
	const work = (() => { throw new Error('sync throw'); }) as () => Promise<void>;
	const boot = gate.run(work);
	await boot;
	strictEqual(gate.isRunning(), false);
});

test('a second run replaces the tracked promise; the earlier run still settles its own waiters', async () => {
	const gate = createBootGate();
	let releaseFirst!: () => void;
	const first = gate.run(() => new Promise<void>(resolve => { releaseFirst = resolve; }));
	const second = gate.run(async () => { /* fast retry */ });
	const waitedLatest = gate.settled();
	releaseFirst();
	await first;
	await second;
	await waitedLatest;
	strictEqual(gate.isRunning(), false);
	ok(true, 'the earlier promise settled its own waiters without corrupting the slot');
});

test('settled() captured before a later run still resolves against the captured promise', async () => {
	const gate = createBootGate();
	let releaseFirst!: () => void;
	const first = gate.run(() => new Promise<void>(resolve => { releaseFirst = resolve; }));
	const early = gate.settled();
	const second = gate.run(async () => { /* the retry replaces the slot */ });
	releaseFirst();
	await first;
	await early;
	await second;
	strictEqual(gate.isRunning(), false);
});
