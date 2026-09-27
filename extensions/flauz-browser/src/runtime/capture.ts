/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Capture + evidence for the Flauz browser runtime (TL3-001).
 *
 * Console capture (Runtime.consoleAPICalled, Log.entryAdded), network capture
 * (Network.requestWillBeSent / responseReceived / loadingFailed), and
 * screenshots — each mappable to an {@link EvidenceRowInput} via the EXISTING
 * `toEvidenceRow` from src/policy.ts (shape pinned by the 96 policy tests;
 * not modified here): the manager evaluates the URL associated with the
 * captured event against the CURRENT policy and maps that verdict through
 * `captureEvidenceRow` below.
 *
 * Artifacts are written through the injected {@link ArtifactWriterPort}
 * (the flauz-environments FileSystemPort pattern): production uses
 * {@link FileSystemArtifactWriter} rooted at the workspace (`.flauz/artifacts/<taskId>/`,
 * DL-21 shape 5); tests inject {@link InMemoryArtifactWriter}.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { CdpParams, CdpTransport } from '../cdp/transport.ts';
import { type EvidenceRowInput, type PolicyVerdict, toEvidenceRow } from '../policy.ts';

// #region Console capture

export interface ConsoleCaptureEntry {
	/** Epoch ms. */
	readonly at: number;
	readonly source: 'Runtime.consoleAPICalled' | 'Log.entryAdded';
	/** 'log' | 'info' | 'warning' | 'error' | 'debug' ... (console) or Log level. */
	readonly level: string;
	/** Rendered text (args joined / entry text). */
	readonly text: string;
	readonly url?: string;
	readonly line?: number;
}

function renderRemoteObject(arg: unknown): string {
	if (arg === null || typeof arg !== 'object') {
		return String(arg);
	}
	const record = arg as Record<string, unknown>;
	switch (record['type']) {
		case 'string':
		case 'number':
		case 'boolean':
			return String(record['value']);
		case 'undefined':
			return 'undefined';
		case 'symbol':
			return typeof record['description'] === 'string' ? record['description'] : 'Symbol()';
		default:
			return typeof record['description'] === 'string' ? record['description'] : '[object]';
	}
}

function consoleEntryFrom(params: CdpParams, at: number): ConsoleCaptureEntry {
	const args = Array.isArray(params['args']) ? params['args'] : [];
	const text = args.map(renderRemoteObject).join(' ');
	return {
		at,
		source: 'Runtime.consoleAPICalled',
		level: typeof params['type'] === 'string' ? params['type'] : 'log',
		text,
	};
}

function logEntryFrom(params: CdpParams, at: number): ConsoleCaptureEntry {
	const entry = (params['entry'] ?? {}) as CdpParams;
	return {
		at,
		source: 'Log.entryAdded',
		level: typeof entry['level'] === 'string' ? entry['level'] : 'info',
		text: typeof entry['text'] === 'string' ? entry['text'] : '',
		url: typeof entry['url'] === 'string' ? entry['url'] : undefined,
		line: typeof entry['lineNumber'] === 'number' ? entry['lineNumber'] : undefined,
	};
}

// #endregion

// #region Network capture

export interface NetworkCaptureEntry {
	/** Epoch ms. */
	readonly at: number;
	readonly phase: 'request' | 'response' | 'failed';
	readonly requestId: string;
	readonly url: string;
	readonly method?: string;
	readonly status?: number;
	readonly errorText?: string;
}

function requestEntryFrom(params: CdpParams, at: number): NetworkCaptureEntry {
	const request = (params['request'] ?? {}) as CdpParams;
	return {
		at,
		phase: 'request',
		requestId: String(params['requestId'] ?? ''),
		url: String(request['url'] ?? ''),
		method: typeof request['method'] === 'string' ? request['method'] : undefined,
	};
}

function responseEntryFrom(params: CdpParams, at: number): NetworkCaptureEntry {
	const response = (params['response'] ?? {}) as CdpParams;
	return {
		at,
		phase: 'response',
		requestId: String(params['requestId'] ?? ''),
		url: String(response['url'] ?? ''),
		status: typeof response['status'] === 'number' ? response['status'] : undefined,
	};
}

function failedEntryFrom(params: CdpParams, at: number): NetworkCaptureEntry {
	return {
		at,
		phase: 'failed',
		requestId: String(params['requestId'] ?? ''),
		url: '',
		errorText: typeof params['errorText'] === 'string' ? params['errorText'] : undefined,
	};
}

// #endregion

// #region The per-tab recorder

/**
 * Buffers console + network events for one tab. `attach` subscribes to the
 * tab's session-scoped transport (idempotent: re-attaching on recovery
 * detaches the previous subscriptions first).
 */
export class TabCaptureRecorder {
	private subscriptions: Array<{ dispose(): void }> = [];
	private readonly consoleBuffer: ConsoleCaptureEntry[] = [];
	private readonly networkBuffer: NetworkCaptureEntry[] = [];
	private readonly limit: number;
	private readonly clock: () => number;

	constructor(options: { limit?: number; clock?: () => number } = {}) {
		this.limit = options.limit ?? 500;
		this.clock = options.clock ?? (() => Date.now());
	}

	attach(transport: CdpTransport): void {
		this.detach();
		const push = <T>(buffer: T[], entry: T): void => {
			buffer.push(entry);
			while (buffer.length > this.limit) {
				buffer.shift();
			}
		};
		this.subscriptions = [
			transport.on('Runtime.consoleAPICalled', params => {
				push(this.consoleBuffer, consoleEntryFrom(params, this.clock()));
			}),
			transport.on('Log.entryAdded', params => {
				push(this.consoleBuffer, logEntryFrom(params, this.clock()));
			}),
			transport.on('Network.requestWillBeSent', params => {
				push(this.networkBuffer, requestEntryFrom(params, this.clock()));
			}),
			transport.on('Network.responseReceived', params => {
				push(this.networkBuffer, responseEntryFrom(params, this.clock()));
			}),
			transport.on('Network.loadingFailed', params => {
				push(this.networkBuffer, failedEntryFrom(params, this.clock()));
			}),
		];
	}

	detach(): void {
		for (const subscription of this.subscriptions) {
			subscription.dispose();
		}
		this.subscriptions = [];
	}

	get console(): readonly ConsoleCaptureEntry[] {
		return this.consoleBuffer;
	}

	get network(): readonly NetworkCaptureEntry[] {
		return this.networkBuffer;
	}

	/** Latest `limit` console entries (oldest first). */
	consoleTail(limit: number = 50): ConsoleCaptureEntry[] {
		return this.consoleBuffer.slice(Math.max(0, this.consoleBuffer.length - limit));
	}

	/** Latest `limit` network entries (oldest first). */
	networkTail(limit: number = 50): NetworkCaptureEntry[] {
		return this.networkBuffer.slice(Math.max(0, this.networkBuffer.length - limit));
	}
}

// #endregion

// #region Evidence + screenshot

/**
 * Maps a capture-associated policy verdict onto the ledger row via the
 * EXISTING `toEvidenceRow` (src/policy.ts — shape unchanged, pinned by the
 * policy tests). The manager evaluates the capture's associated URL against
 * the CURRENT policy and delegates here.
 */
export function captureEvidenceRow(verdict: PolicyVerdict, taskId: string | undefined): EvidenceRowInput {
	return toEvidenceRow(verdict, taskId);
}

export interface ScreenshotOutcome {
	/** Decoded image bytes. */
	readonly bytes: Uint8Array;
	readonly byteLength: number;
	/** The verdict row for the tab's (committed) URL under the CURRENT policy. */
	readonly evidenceRow: EvidenceRowInput;
	/** The artifact path when an artifact writer was configured. */
	readonly artifactPath?: string;
	/** base64 of `bytes` (JSON-safe return shape for command results). */
	readonly base64: string;
}

/** Decodes a CDP `Page.captureScreenshot` result into bytes. */
export function decodeScreenshotBase64(data: string): Uint8Array {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

// #endregion

// #region Artifact writer port

/**
 * The artifact-writer port (flauz-environments `FileSystemPort` pattern):
 * injected, so tests use the in-memory implementation. Writes capture
 * artifacts under `.flauz/artifacts/<taskId>/`.
 */
export interface ArtifactWriterPort {
	/** Writes `bytes` to the task's artifact directory; returns the artifact path. */
	writeArtifact(taskId: string, name: string, bytes: Uint8Array): Promise<string>;
}

const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Production writer: `<rootDir>/.flauz/artifacts/<taskId>/<name>` (DL-21 shape 5). */
export class FileSystemArtifactWriter implements ArtifactWriterPort {
	private readonly rootDir: string;

	constructor(rootDir: string) {
		this.rootDir = rootDir;
	}

	async writeArtifact(taskId: string, name: string, bytes: Uint8Array): Promise<string> {
		assertSafeArtifactSegments(taskId, name);
		const directory = path.join(this.rootDir, '.flauz', 'artifacts', taskId);
		await mkdir(directory, { recursive: true });
		const filePath = path.join(directory, name);
		await writeFile(filePath, bytes);
		return filePath;
	}
}

/** Test/in-memory writer: records writes, returns the logical path. */
export class InMemoryArtifactWriter implements ArtifactWriterPort {
	readonly entries: Array<{ taskId: string; name: string; path: string; bytes: Uint8Array }> = [];

	async writeArtifact(taskId: string, name: string, bytes: Uint8Array): Promise<string> {
		assertSafeArtifactSegments(taskId, name);
		const artifactPath = `.flauz/artifacts/${taskId}/${name}`;
		this.entries.push({ taskId, name, path: artifactPath, bytes });
		return artifactPath;
	}
}

function assertSafeArtifactSegments(taskId: string, name: string): void {
	if (!SAFE_SEGMENT_RE.test(taskId)) {
		throw new Error(`flauz.browser: unsafe artifact taskId ${JSON.stringify(taskId)}`);
	}
	if (!SAFE_SEGMENT_RE.test(name)) {
		throw new Error(`flauz.browser: unsafe artifact name ${JSON.stringify(name)}`);
	}
}

// #endregion
