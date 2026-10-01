/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `frictionlog.mjs` (the A-PROD-003-W1 dogfood
 * friction-log contract). Hand-written per the zero-dependency
 * discipline (extensions/flauz-agent/core/a2a.d.mts pattern) so the
 * harness's TypeScript modules and tests typecheck against the real
 * runtime module without a repo install.
 */

export declare const FRICTION_SCHEMA: 'flauz.dogfood-friction/v1';

export declare const FRICTION_KINDS: readonly string[];

export declare function isFrictionKind(value: unknown): boolean;

export interface FrictionLineValidation {
	readonly ok: boolean;
	readonly error?: string;
}

export declare function validateFrictionLine(value: unknown): FrictionLineValidation;

export interface ParsedFrictionLog {
	readonly ok: boolean;
	readonly error: string;
	readonly rows: readonly Record<string, unknown>[];
}

export declare function parseFrictionLog(text: string): ParsedFrictionLog;

export declare class FrictionLog {
	constructor(options: {
		readonly path: string;
		readonly appendFile?: (target: string, contents: string) => Promise<void>;
		readonly readFile?: (target: string) => Promise<string>;
		readonly clock?: () => number;
	});

	readonly path: string;
	readonly lines: number;

	friction(input: { phase: string; kind: string; detail: string; recovery?: string }): Promise<Record<string, unknown>>;

	timing(input: { phase: string; durationMs: number }): Promise<Record<string, unknown>>;

	readAll(): Promise<readonly Record<string, unknown>[]>;
}
