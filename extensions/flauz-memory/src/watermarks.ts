/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Watermark evolution (TL2-005/M5, Worker C): high-water marks per stream
 * enabling INCREMENTAL CATCH-UP after restart.
 *
 * Streams (v0): task-events, a2a-mailbox, memory-writes, workflow-runs.
 * The watermark envelope persists at `.flauz/watermarks.json` (atomic
 * tmp+rename). Watermarks NEVER regress (a regression is a typed error);
 * `catchUp` reads only the rows AFTER the stream's high-water mark through
 * the injected StreamJournalPort, so a restart replays nothing already
 * consumed (exactly-once delivery to the catching-up consumer).
 *
 * Every watermark row maps to a REAL recorded position (the journal port
 * returns actual rows; the service records what it actually read - no
 * fabricated watermarks).
 *
 * Node-free core: IO through FileSystemPort/Clock only.
 */

import {
	type Clock,
	type FileSystemPort,
	deepSorted,
	joinPath,
} from '../../flauz-workspace/src/api.ts';

/** Schema pinned into the watermarks envelope. */
export const WATERMARKS_SCHEMA = 'flauz.watermarks/v1';

/** Envelope path, relative to the workspace root. */
export const WATERMARKS_PATH = '.flauz/watermarks.json';

/** The v0 stream ids (one per durable journal the substrate owns). */
export const STREAM_IDS = ['task-events', 'a2a-mailbox', 'memory-writes', 'workflow-runs'] as const;
export type StreamId = (typeof STREAM_IDS)[number];

export interface StreamWatermark {
	readonly streamId: StreamId;
	/** The last CONSUMED position (rows are 1-based). */
	readonly highWater: number;
	readonly updatedAt: number;
}

export interface WatermarksEnvelope {
	readonly $schema: string;
	readonly streams: Readonly<Record<string, StreamWatermark>>;
}

/** One journal row a stream can deliver (position + the raw canonical line). */
export interface StreamRow {
	readonly position: number;
	readonly line: string;
}

/**
 * Reads a stream's rows from a position (inclusive of `from`). The wiring
 * maps each stream id to its real journal (task envelope event count, a2a
 * message seq, memory journal line, workflow run index).
 */
export interface StreamJournalPort {
	read(streamId: StreamId, from: number): Promise<readonly StreamRow[]>;
}

export interface CatchUpResult {
	readonly streamId: StreamId;
	/** Rows after the previous high-water (empty when already caught up). */
	readonly rows: readonly StreamRow[];
	readonly fromHighWater: number;
	readonly toHighWater: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStreamId(value: unknown): value is StreamId {
	return typeof value === 'string' && (STREAM_IDS as readonly string[]).includes(value);
}

export interface WatermarkServiceOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly journals: StreamJournalPort;
	readonly clock?: Clock;
}

export class WatermarkService {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly journals: StreamJournalPort;
	private readonly clock: Clock;

	constructor(options: WatermarkServiceOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.journals = options.journals;
		this.clock = options.clock ?? (() => Date.now());
	}

	private path(): string {
		return joinPath(this.root, WATERMARKS_PATH);
	}

	/** Creates the empty envelope when absent. Idempotent. */
	async ensure(): Promise<void> {
		if (await this.fs.readFileUtf8(this.path()) === undefined) {
			await this.persist({ $schema: WATERMARKS_SCHEMA, streams: {} });
		}
	}

	async load(): Promise<WatermarksEnvelope> {
		const raw = await this.fs.readFileUtf8(this.path());
		if (raw === undefined) {
			throw new Error(`flauz.watermarks: envelope not found at ${WATERMARKS_PATH} (ensure() required)`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			throw new Error(`flauz.watermarks: envelope is not valid JSON: ${(err as Error).message}`);
		}
		return this.validate(parsed);
	}

	private validate(value: unknown): WatermarksEnvelope {
		if (!isPlainObject(value) || Object.keys(value).length !== 2 || !Object.prototype.hasOwnProperty.call(value, '$schema') || !Object.prototype.hasOwnProperty.call(value, 'streams')) {
			throw new Error('flauz.watermarks: envelope must have exactly the keys [$schema, streams]');
		}
		if (value.$schema !== WATERMARKS_SCHEMA) {
			throw new Error(`flauz.watermarks: $schema must be '${WATERMARKS_SCHEMA}' (got ${JSON.stringify(value.$schema)})`);
		}
		if (!isPlainObject(value.streams)) {
			throw new Error('flauz.watermarks: streams must be an object keyed by stream id');
		}
		for (const [streamId, watermark] of Object.entries(value.streams)) {
			if (!isStreamId(streamId)) {
				throw new Error(`flauz.watermarks: unknown stream id '${streamId}'`);
			}
			const row = watermark as Record<string, unknown>;
			if (!isPlainObject(row) || Object.keys(row).length !== 3 || !Object.prototype.hasOwnProperty.call(row, 'streamId') || !Object.prototype.hasOwnProperty.call(row, 'highWater') || !Object.prototype.hasOwnProperty.call(row, 'updatedAt')) {
				throw new Error(`flauz.watermarks: stream '${streamId}' must have exactly the keys [highWater, streamId, updatedAt]`);
			}
			if (row.streamId !== streamId) {
				throw new Error(`flauz.watermarks: stream '${streamId}' row carries streamId '${String(row.streamId)}'`);
			}
			if (typeof row.highWater !== 'number' || !Number.isSafeInteger(row.highWater) || row.highWater < 0) {
				throw new Error(`flauz.watermarks: stream '${streamId}' highWater must be a non-negative integer`);
			}
			if (typeof row.updatedAt !== 'number' || !Number.isSafeInteger(row.updatedAt) || row.updatedAt <= 0) {
				throw new Error(`flauz.watermarks: stream '${streamId}' updatedAt must be a positive integer`);
			}
		}
		return { $schema: WATERMARKS_SCHEMA, streams: value.streams as Readonly<Record<string, StreamWatermark>> };
	}

	private async persist(envelope: WatermarksEnvelope): Promise<void> {
		const target = this.path();
		const tmp = `${target}.tmp`;
		await this.fs.writeFile(tmp, `${JSON.stringify(deepSorted(envelope), null, 2)}\n`);
		await this.fs.rename(tmp, target);
	}

	/** The current high-water mark of a stream (0 when never consumed). */
	async highWater(streamId: StreamId): Promise<number> {
		const envelope = await this.load();
		return envelope.streams[streamId]?.highWater ?? 0;
	}

	/**
	 * Records a consumed position. Watermarks NEVER regress: recording a
	 * position below the current high-water is a typed error.
	 */
	async record(streamId: StreamId, position: number): Promise<StreamWatermark> {
		if (!isStreamId(streamId)) {
			throw new Error(`flauz.watermarks: unknown stream id ${JSON.stringify(streamId)}`);
		}
		if (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0) {
			throw new Error('flauz.watermarks: position must be a non-negative integer');
		}
		const envelope = await this.load();
		const current = envelope.streams[streamId]?.highWater ?? 0;
		if (position < current) {
			throw new Error(`flauz.watermarks: stream '${streamId}' high-water never regresses (current ${String(current)}, got ${String(position)})`);
		}
		const row: StreamWatermark = { streamId, highWater: position, updatedAt: this.clock() };
		const streams = { ...envelope.streams, [streamId]: row };
		await this.persist({ $schema: WATERMARKS_SCHEMA, streams });
		return row;
	}

	/**
	 * Incremental catch-up: reads ONLY the rows after the stream's
	 * high-water mark (through the journal port), records the new high-water
	 * from the rows ACTUALLY read, and returns them. A restart replays
	 * nothing already consumed.
	 */
	async catchUp(streamId: StreamId): Promise<CatchUpResult> {
		const fromHighWater = await this.highWater(streamId);
		const rows = await this.journals.read(streamId, fromHighWater + 1);
		let toHighWater = fromHighWater;
		for (const row of rows) {
			if (row.position > toHighWater) {
				toHighWater = row.position;
			}
		}
		if (toHighWater !== fromHighWater) {
			await this.record(streamId, toHighWater);
		}
		return { streamId, rows, fromHighWater, toHighWater };
	}
}
