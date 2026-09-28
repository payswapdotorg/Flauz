/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- durable `.flauz/models` state files (M3).
 *
 * The envelope discipline established by the sibling Flauz extensions:
 * canonical JSON (sorted keys), 2-space indent, exactly one trailing
 * newline, atomic tmp-then-rename writes, append-only JSONL ledgers that
 * preserve every existing byte, STRICT parsing (unknown keys / wrong schema
 * ids / malformed JSON are typed STORE_CORRUPT failures -- never silently
 * reinterpreted).
 */

import type { FileSystemPort } from '../contract/ports.ts';
import { serializeDocument } from '../contract/canonical.ts';

/** Typed durable-state failure. */
export class StateFileError extends Error {
	readonly code: 'STORE_CORRUPT' | 'WRITE_FAILED';
	readonly path: string;

	constructor(code: 'STORE_CORRUPT' | 'WRITE_FAILED', path: string, message: string) {
		super(message);
		this.name = 'StateFileError';
		this.code = code;
		this.path = path;
	}
}

/** POSIX join (the `.flauz` family is POSIX-shaped across Flauz). */
export function joinStatePath(...parts: readonly string[]): string {
	return parts.filter(part => part.length > 0).join('/').replace(/\/{2,}/g, '/');
}

/** mkdir -p through the port (segment walk; existing dirs are fine; absolute paths preserved). */
export async function ensureDir(fs: FileSystemPort, path: string): Promise<void> {
	const absolute = path.startsWith('/');
	const segments = path.split('/').filter(segment => segment.length > 0);
	let current = '';
	for (const segment of segments) {
		current = current.length === 0 ? (absolute ? `/${segment}` : segment) : `${current}/${segment}`;
		await fs.mkdir(current);
	}
}

/** Atomic write: tmp file + rename (readers never observe a torn file). */
export async function atomicWrite(fs: FileSystemPort, path: string, contents: string): Promise<void> {
	try {
		await ensureDir(fs, dirnameOf(path));
		const tmp = `${path}.tmp`;
		await fs.writeFile(tmp, contents);
		await fs.rename(tmp, path);
	} catch (error) {
		throw new StateFileError('WRITE_FAILED', path, `failed to write state file '${path}': ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** POSIX dirname (path-shape only; the .flauz family never needs more). */
export function dirnameOf(path: string): string {
	const index = path.lastIndexOf('/');
	return index <= 0 ? '' : path.slice(0, index);
}

/**
 * Reads and STRICTLY parses a state file. Returns undefined when the file
 * does not exist (first run); throws StateFileError('STORE_CORRUPT') on
 * malformed JSON, non-object roots or a wrong schema id.
 */
export async function readEnvelope(fs: FileSystemPort, path: string, expectedSchema: string): Promise<Record<string, unknown> | undefined> {
	const text = await fs.readFileUtf8(path);
	if (text === undefined) {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new StateFileError('STORE_CORRUPT', path, `state file '${path}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new StateFileError('STORE_CORRUPT', path, `state file '${path}' root is not an object`);
	}
	const record = parsed as Record<string, unknown>;
	if (record.schema !== expectedSchema) {
		throw new StateFileError('STORE_CORRUPT', path, `state file '${path}' carries schema '${String(record.schema)}' but '${expectedSchema}' was expected`);
	}
	return record;
}

/** Serializes an envelope for the durable file (canonical form). */
export function envelopeText(envelope: unknown): string {
	return serializeDocument(envelope);
}

/** Appends one canonical compact line to a JSONL ledger (read + validate + extend + atomic rewrite). */
export async function appendJsonlLine(fs: FileSystemPort, path: string, line: Record<string, unknown>): Promise<void> {
	const existing = await fs.readFileUtf8(path);
	const lines = (existing ?? '').split('\n').filter(line => line.trim().length > 0);
	for (const candidate of lines) {
		try {
			JSON.parse(candidate);
		} catch {
			throw new StateFileError('STORE_CORRUPT', path, `ledger '${path}' contains a non-JSON line; refusing to append to a mutated ledger`);
		}
	}
	lines.push(JSON.stringify(line));
	await atomicWrite(fs, path, `${lines.join('\n')}\n`);
}

/** Reads every JSONL ledger line (empty array when absent; corrupt lines throw). */
export async function readJsonl(fs: FileSystemPort, path: string): Promise<Record<string, unknown>[]> {
	const existing = await fs.readFileUtf8(path);
	if (existing === undefined) {
		return [];
	}
	const records: Record<string, unknown>[] = [];
	for (const line of existing.split('\n')) {
		if (line.trim().length === 0) {
			continue;
		}
		try {
			const parsed = JSON.parse(line) as unknown;
			if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('not an object');
			}
			records.push(parsed as Record<string, unknown>);
		} catch (error) {
			throw new StateFileError('STORE_CORRUPT', path, `ledger '${path}' contains a malformed line: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return records;
}
