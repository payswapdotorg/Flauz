/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared test helpers: deterministic clocks, a pinned acquisition-id
 * minter, a temp workspace root, and the repo fixture readers.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecJournalStore } from '../src/journal.ts';

/** A clock that steps by `stepMs` per call (deterministic fixtures). */
export function steppingClock(startMs: number, stepMs = 1000): () => number {
	let current = startMs;
	return () => {
		const value = current;
		current += stepMs;
		return value;
	};
}

/** A clock pinned to one instant. */
export function fixedClock(startMs: number): () => number {
	return () => startMs;
}

/** A pinned minter: sequentially flauz:exec:<16-hex> from a hex counter. */
export function pinnedMinter(): () => string {
	let counter = 0;
	return () => {
		counter += 1;
		return `flauz:exec:${counter.toString(16).padStart(16, '0')}`;
	};
}

/** A temp workspace root; returns the root path and a cleanup. */
export function tempRoot(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), 'flauz-exec-'));
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** A store over a temp root with the deterministic clock + minter. */
export function tempStore(options: { clock?: () => number } = {}): { store: ExecJournalStore; root: string; cleanup: () => void } {
	const { root, cleanup } = tempRoot();
	const store = new ExecJournalStore(root, { clock: options.clock ?? steppingClock(1730000000000), mintAcquisitionId: pinnedMinter() });
	return { store, root, cleanup };
}

/** Reads one repo fixture (repo-root test/fixtures/execution/<relative>). */
export function readFixture(relative: string): string {
	const path = join(import.meta.dirname, '..', '..', '..', 'test', 'fixtures', 'execution', relative);
	return readFileSync(path, 'utf-8');
}

/** The canonical resource refs used across the suites. */
export const BROWSER_REF = { resourceClass: 'browser-session', kind: 'browser-session', id: 'flauz:browser:9c8d7e6f5a4b3c2d' } as const;
export const ENVIRONMENT_REF = { resourceClass: 'environment', kind: 'environment', id: 'flauz:environment:env-staging' } as const;
export const FILE_REF = { resourceClass: 'logical-resource', kind: 'file', id: 'flauz:file:4d5e6f708192a3b4' } as const;
export const ARTIFACT_REF = { resourceClass: 'logical-resource', kind: 'artifact', id: 'flauz:artifact:a1b2c3d4e5f60718' } as const;
